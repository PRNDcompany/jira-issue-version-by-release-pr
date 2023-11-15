# Jira issue version by release PR
This action extract jira keys from release PR and add version to target jira issue

## Inputs
- `github-token`: GitHub token. 
  - ex) `${{ secrets.GITHUB_TOKEN }}`.
- `jira-token`: Jira API token key (Not Api key)
  - read [Jira Token] section
- `jira-domain`: Domain name (`https://your-domain.atlassian.net`)
- `jira-version-prefix`: Your jira version's prefix name
  - If your versions name is `Customer 1.0.0`, `jira-version-prefix` is `Customer`
- `skip-subtask`: Skip subtask issue
  - Maybe you don't want to add version to subtask issue. because subtask issue has parent issue
  - we only think about parent issue's version
  - but if you want to add version to subtask issue, set `false` 
  - default: `true`

### Jira Token
https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/

1. Generate an API token for Jira using your [Atlassian Account](https://id.atlassian.com/manage/api-tokens).
2. Build a string of the form `useremail:api_token`. (ted@prnd.co.kr:xxxxxxx) 
3. BASE64 encode the string.
- Linux/Unix/MacOS:
```
echo -n user@example.com:api_token_string | base64
```
- Windows 7 and later, using Microsoft Powershell:
```
$Text = ‘user@example.com:api_token_string’
$Bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
$EncodedText = [Convert]::ToBase64String($Bytes)
$EncodedText
```


## Outputs
- `jira_issue_keys`: Jira issue key list 


## Example usage
```yaml
name: Add version to jira issue by release PR
on:
  pull_request:
    types: [ opened, synchronize, ready_for_review ]
    branches:
      - main
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - name: Jira issue version by release PR
      id: add_jira_issue_version
      uses: PRNDcompany/jira-issue-version-by-release-pr@v0.1
      with:
        github-token: ${{ secrets.GITHUB_TOKEN }}
        jira-token: ${{ secrets.JIRA_TOKEN }}
        jira-domain: 'your-domain'
        jira-version-prefix: 'Customer'
    - name: Print jira issue keys
      run: |
        echo ${{ steps.add_jira_issue_version.outputs.jira_issue_keys }}
```
