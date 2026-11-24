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

Note: Microsoft Graph accepting sendMail confirms submission to Outlook, not independent mailbox receipt confirmation.

Regards,
QA Automation Team
`;
}

function buildValidationSubject(data) {
  return `QA Automation Execution Report – ${data.projectName || data.storyKey} – ${data.executionDate}`;
}

function buildValidationBody(data) {
  const m = data.metrics || {};
  return `Hi,

The automated QA test execution has been completed.

Please find the attached execution reports in PDF and Excel formats.

Execution Summary:
- Project: ${data.projectName}
- Execution Date: ${data.executionDate}
- Total Test Cases: ${m.totalTestCases}
- Passed: ${m.passed}
- Failed: ${m.failed}
- Skipped: ${m.notExecuted}
- Blocked: ${m.blocked}
- Execution Status: ${data.overallStatus}

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
