"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const request = __importStar(require("request-promise"));
const rest_1 = require("@octokit/rest");
(async () => {
    const githubToken = core.getInput("github-token");
    const jiraToken = core.getInput("jira-token");
    const jiraDomain = core.getInput("jira-domain");
    const jiraVersionPrefix = core.getInput("jira-version-prefix");
    const skipSubtask = core.getInput("skip-subtask") == 'true';
    const payload = github.context.payload;
    const repository = payload.repository;
    if (repository == null) {
        core.setFailed("github.context.payload.repository is null");
        return;
    }
    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = payload.number;
    const pullRequest = payload.pull_request;
    if (pullRequest == null) {
        core.setFailed("github.context.payload.pull_request is null");
        return;
    }
    const branchName = pullRequest.head.ref;
    try {
        const jiraVersionName = getJiraVersionName(branchName, jiraVersionPrefix);
        console.log("jiraVersionName: ", jiraVersionName);
        if (jiraVersionName == null) {
            core.setFailed("jiraVersionName is null");
            return;
        }
        const commitMessages = await getGitHubCommitMessages(githubToken, owner, repo, prNumber);
        const rawJiraIssueKeys = extractJiraIssueKeys(commitMessages);
        console.log("raw jiraIssueKeys: ", rawJiraIssueKeys);
        const jiraBaseUrl = `https://${jiraDomain}.atlassian.net/rest/api/3`;
        const jiraIssues = await getValidateJiraIssues(jiraToken, jiraBaseUrl, rawJiraIssueKeys, jiraVersionName, skipSubtask);
        console.log("jiraIssues: ", jiraIssues);
        for (const issue of jiraIssues) {
            await addJiraIssueVersion(jiraToken, jiraBaseUrl, issue.key, jiraVersionName);
        }
        const outputJiraIssueKeys = jiraIssues.map((issue) => issue.key);
        core.setOutput("jira_issue_keys", outputJiraIssueKeys);
    }
    catch (error) {
        core.setFailed(error.message);
    }
})();
async function getGitHubCommitMessages(githubToken, owner, repo, prNumber) {
    const octokit = new rest_1.Octokit({ auth: githubToken, });
    const result = await octokit.paginate("GET /repos/{owner}/{repo}/pulls/{prNum}/commits", {
        "owner": owner,
        "repo": repo,
        "prNum": prNumber,
        "per_page": 100,
        "headers": {
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    return result.flat().map((data) => {
        return data.commit.message;
    });
}
function extractJiraIssueKeys(commitMessages) {
    const regex = new RegExp(`[A-Z]+-\\d+`, "g");
    const jiraKeys = [];
    for (const commitMessage of commitMessages) {
        // Find jira id per commitMessage
        const matches = regex.exec(commitMessage);
        if (matches == null) {
            continue;
        }
        for (const match of matches) {
            if (jiraKeys.find((element) => element === match)) {
                // Already exist
            }
            else {
                jiraKeys.push(match);
            }
        }
    }
    // sort by number
    return jiraKeys.sort((first, second) => (first > second ? 1 : -1));
}
function getJiraVersionName(branchName, jiraVersionPrefix) {
    const regex = new RegExp(`release/(\\d+\\.\\d+\\.\\d+)`, "g");
    const matches = regex.exec(branchName);
    if (matches == null) {
        return null;
    }
    const versionName = matches[1];
    if (jiraVersionPrefix != null) {
        return `${jiraVersionPrefix} ${versionName}`;
    }
    else {
        return versionName;
    }
}
async function getValidateJiraIssues(jiraToken, baseUrl, jiraIssueKeys, jiraVersionName, skipSubtask) {
    // Get jira issue from jiraIssueKey
    const jiraIssues = await Promise.all(jiraIssueKeys.map((jiraIssueKey) => {
        return getJiraIssue(jiraToken, baseUrl, jiraIssueKey);
    }));
    // Filter subtask and already fixed version
    return jiraIssues.filter((issue) => {
        if (skipSubtask && issue.isSubtask) {
            return false;
        }
        else if (issue.fixVersions.includes(jiraVersionName)) {
            return false;
        }
        return true;
    });
}
async function getJiraIssue(jiraToken, baseUrl, jiraIssueKey) {
    //https://yourdomain.atlassian.net/rest/api/3/issue/ABC-10829
    const url = `${baseUrl}/issue/${jiraIssueKey}`;
    const response = await request.get(url, {
        headers: {
            Authorization: `Basic ${jiraToken}`
        },
        json: true,
    });
    const fields = response.fields;
    return new Issue(jiraIssueKey, fields.issuetype.subtask, fields.fixVersions.map((fixVersion) => fixVersion.name));
}
async function addJiraIssueVersion(jiraToken, baseUrl, jiraIssueKey, jiraVersionName) {
    //https://yourdomain.atlassian.net/rest/api/3/issue/ABC-10829
    const url = `${baseUrl}/issue/${jiraIssueKey}`;
    await request.put(url, {
        headers: {
            Authorization: `Basic ${jiraToken}`
        },
        json: true,
        body: {
            update: {
                fixVersions: [{
                        add: { name: jiraVersionName }
                    }]
            }
        }
    });
}
class Issue {
    constructor(key, isSubtask, fixVersions) {
        this.key = key;
        this.isSubtask = isSubtask;
        this.fixVersions = fixVersions;
    }
}
