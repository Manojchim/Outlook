"use strict";

function buildEmailSubject(data, config) {
  const prefix = config.subjectPrefix || "[QA Execution Report]";
  const status = data.overallStatus || "UNKNOWN";
  return `${prefix} ${data.storyKey} – ${data.storyTitle} – ${status}`;
}

function buildEmailBody(data) {
  const m = data.metrics || {};
  const bugLines = (data.bugs || [])
    .map(
      (b) =>
        `- ${b.key} (${b.priority}, ${b.status}): ${b.summary}${b.url ? ` — ${b.url}` : ""}`
    )
    .join("\n");

  return `Hello Team,

The QA execution for the following Jira User Story has been completed.

User Story Details
- Jira ID: ${data.storyKey}${data.storyUrl ? ` (${data.storyUrl})` : ""}
- User Story: ${data.storyTitle}
- Test Cycle: ${data.testCycleKey}
- Environment: ${data.environment}
- Execution Date: ${data.executionDate}

Execution Summary
- Total Test Cases: ${m.totalTestCases}
- Passed: ${m.passed}
- Failed: ${m.failed}
- Blocked: ${m.blocked}
- Not Executed: ${m.notExecuted}
- Bugs Created: ${m.bugsCreated}
- Screenshots Uploaded: ${m.screenshotsUploaded}
- Execution Completion %: ${m.executionCompletionPercent}
- Pass % (of executed): ${m.passPercent}

Defect Summary
${bugLines || "- None"}

QA Recommendation
${data.recommendation}

Both detailed reports are attached:
1. PDF QA Execution Report
2. Excel QA Execution Report

Please refer to the attached reports for complete test execution details and defect information.

Note: SMTP acceptance confirms server submission, not independent mailbox receipt confirmation.

Regards,
QA Automation Team
`;
}

/**
 * Production QA report subject:
 * QA Automation Report - {JIRA_STORY_KEY} - {EXECUTION_DATE}
 */
function buildValidationSubject(data) {
  const storyKey = data.storyKey || data.projectKey || "SCRUM";
  const executionDate = data.executionDate || "UNKNOWN";
  return `QA Automation Report - ${storyKey} - ${executionDate}`;
}

function buildValidationBody(data) {
  const m = data.metrics || {};
  const pdfName =
    data.attachmentFilenames?.pdf ||
    data.files?.pdfBaseName ||
    "QA Report (PDF)";
  const xlsxName =
    data.attachmentFilenames?.xlsx ||
    data.files?.xlsxBaseName ||
    "QA Report (Excel)";
  const executedAt =
    data.executionDateTime ||
    data.executedAt ||
    data.executionDate ||
    "Not available";

  return `Hello,

The automated QA execution report is ready.

Jira Story
- Key: ${data.storyKey || "Not available"}
- Title: ${data.storyTitle || "Not available"}

Zephyr
- Project: ${data.projectKey || data.projectName || "Not available"}
- Test Cycle: ${data.testCycleName || data.testCycleKey || "Not available"}

Execution
- Date / time: ${executedAt}
- Total test cases: ${m.totalTestCases ?? "n/a"}
- Passed: ${m.passed ?? "n/a"}
- Failed: ${m.failed ?? "n/a"}
- Blocked: ${m.blocked ?? "n/a"}
- Not executed: ${m.notExecuted ?? "n/a"}
- Overall result: ${data.overallStatus || "UNKNOWN"}

Attachments
1. PDF: ${pdfName}
2. Excel: ${xlsxName}

SMTP acceptance means the mail server accepted the message. Inbox receipt must be confirmed separately.

Regards,
QA Automation Framework
`;
}

module.exports = {
  buildEmailSubject,
  buildEmailBody,
  buildValidationSubject,
  buildValidationBody
};
