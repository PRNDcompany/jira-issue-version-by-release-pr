import * as core from "@actions/core";
import * as github from "@actions/github";
import * as request from "request-promise";
import {Octokit} from "@octokit/rest";

let failJiraIssueKeys: string[] = [];

(async () => {
    const githubToken = core.getInput("github-token")
    const jiraToken = core.getInput("jira-token")
    const jiraDomain = core.getInput("jira-domain")
    const jiraVersionPrefix = core.getInput("jira-version-prefix")
    const skipSubtask = core.getInput("skip-subtask") == 'true'
    const skipChild = core.getInput("skip-child") == 'true'

    const payload = github.context.payload
    const repository = payload.repository
    if (repository == null) {
        core.setFailed("github.context.payload.repository is null")
        return
    }
    const owner = repository.owner.login
    const repo = repository.name
    const prNumber = payload.number
    const pullRequest = payload.pull_request
    if (pullRequest == null) {
        core.setFailed("github.context.payload.pull_request is null")
        return
    }
    const branchName = pullRequest.head.ref

    try {
        const jiraVersionName = getJiraVersionName(branchName, jiraVersionPrefix)
        console.log("jiraVersionName: ", jiraVersionName)
        if (jiraVersionName == null) {
            core.setFailed("jiraVersionName is null")
            return
        }

        const commitMessages = await getGitHubCommitMessages(githubToken, owner, repo, prNumber)
        const rawJiraIssueKeys = extractJiraIssueKeys(commitMessages)
        console.log("raw jiraIssueKeys: ", rawJiraIssueKeys)
        const jiraBaseUrl = `https://${jiraDomain}.atlassian.net/rest/api/3`
        const jiraIssues: Issue[] = await getValidateJiraIssues(jiraToken, jiraBaseUrl, rawJiraIssueKeys, jiraVersionName, skipSubtask, skipChild)
        console.log("jiraIssues: ", jiraIssues)
        for (const issue of jiraIssues) {
            await addJiraIssueVersion(jiraToken, jiraBaseUrl, issue.key, jiraVersionName)
                .catch((e: any) => {
                    console.log(`[addJiraIssueVersion][${issue.key}]: ${e.message}}`)
                    failJiraIssueKeys.push(issue.key)
                })
        }

        const outputJiraIssueKeys = jiraIssues.map((issue: Issue) => issue.key)
        core.setOutput("jira_issue_keys", outputJiraIssueKeys)
        core.setOutput("fail_jira_issue_keys", failJiraIssueKeys)
    } catch (error: any) {
        core.setFailed(error.message);
    }

})();


async function getGitHubCommitMessages(githubToken: string, owner: string, repo: string, prNumber: number): Promise<string[]> {

    const octokit = new Octokit({auth: githubToken,})
    const result: any[] = await octokit.paginate("GET /repos/{owner}/{repo}/pulls/{prNum}/commits", {
        "owner": owner,
        "repo": repo,
        "prNum": prNumber,
        "per_page": 100,
        "headers": {
            "X-GitHub-Api-Version": "2022-11-28",
        },
    })

    return result.flat().map((data: any) => {
        return data.commit.message
    })
}

function extractJiraIssueKeys(commitMessages: string[]): string[] {
    const regex = new RegExp(`^[A-Z]+-\\d+`, "g")
    const jiraKeys: string[] = []
    for (const commitMessage of commitMessages) {
        // Find jira id per commitMessage
        const matches: string[] | null = regex.exec(commitMessage)
        if (matches == null) {
            continue
        }
        for (const match of matches) {
            if (jiraKeys.find((element: string) => element === match)) {
                // Already exist
            } else {
                jiraKeys.push(match)
            }
        }
    }
    // sort by number
    return jiraKeys.sort((first, second) => (first > second ? 1 : -1))
}

function getJiraVersionName(branchName: string, jiraVersionPrefix?: string): string | null {
    const regex = new RegExp(`/(\\d+\\.\\d+\\.\\d+)`, "g")
    const matches: string[] | null = regex.exec(branchName)
    if (matches == null) {
        return null
    }
    const versionName = matches[1]
    if (jiraVersionPrefix != null) {
        return `${jiraVersionPrefix} ${versionName}`
    } else {
        return versionName
    }
}

async function getValidateJiraIssues(jiraToken: string, baseUrl: string, jiraIssueKeys: string[], jiraVersionName: string, skipSubtask: boolean, skipChild: boolean) {
    // Get jira issue from jiraIssueKey
    const jiraIssues: Issue[] = await Promise.all(
        jiraIssueKeys.map((jiraIssueKey: string) => {
            return getJiraIssue(jiraToken, baseUrl, jiraIssueKey)
                .catch((e: any) => {
                    console.log(`[getJiraIssue][${jiraIssueKey}]: ${e.message}}`)
                    failJiraIssueKeys.push(jiraIssueKey)
                    return new Issue("", true, [])
                })
        })
    );

    // Filter subtask and already fixed version
    return jiraIssues.filter((issue: Issue) => {
        if (issue.key == "") {
            return false
        } else if (skipSubtask && issue.isSubtask) {
            return false
        } else if (skipChild) {
            const isChildTask = issue.parentKey != null || issue.project == issue.parentProject
            return !isChildTask
        } else if (issue.fixVersions.includes(jiraVersionName)) {
            return false
        }

        return true
    })
}

async function getJiraIssue(jiraToken: string, baseUrl: string, jiraIssueKey: string) {
    //https://yourdomain.atlassian.net/rest/api/3/issue/ABC-10829
    const url = `${baseUrl}/issue/${jiraIssueKey}`
    const response = await request.get(url, {
        headers: {
            Authorization: `Basic ${jiraToken}`
        },
        json: true,
    });

    const fields = response.fields
    const fixVersions = fields.fixVersions.map((fixVersion: any) => fixVersion.name)
    const parentKey = fields.parent?.key
    return new Issue(jiraIssueKey, fields.issuetype.subtask, fixVersions, parentKey)
}


async function addJiraIssueVersion(jiraToken: string, baseUrl: string, jiraIssueKey: string, jiraVersionName: string) {
    //https://yourdomain.atlassian.net/rest/api/3/issue/ABC-10829
    const url = `${baseUrl}/issue/${jiraIssueKey}`
    await request.put(url, {
        headers: {
            Authorization: `Basic ${jiraToken}`
        },
        json: true,
        body: {
            update: {
                fixVersions: [{
                    add: {name: jiraVersionName}
                }]
            }
        }
    });
}

class Issue {

    key: string
    project: string
    isSubtask: boolean
    fixVersions: string[]
    parentKey?: string
    parentProject?: string

    constructor(key: string, isSubtask: boolean, fixVersions: string[], parentKey?: string) {
        this.key = key;
        this.project = key.split("-")[0];
        this.isSubtask = isSubtask;
        this.fixVersions = fixVersions;
        this.parentKey = parentKey;
        this.parentProject = parentKey?.split("-")[0];
    }
}
