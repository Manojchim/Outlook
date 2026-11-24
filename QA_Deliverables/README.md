# QA Deliverables - Text-Readable Formats

The original Excel workbooks are retained. Human-readable alternatives are available in both Markdown and CSV formats.

| Deliverable | Markdown | CSV | Excel |
|---|---|---|---|
| Application analysis | [01_Application_Analysis.md](01_Application_Analysis.md) | - | - |
| User stories | [02_User_Stories.md](02_User_Stories.md) | [02_User_Stories.csv](02_User_Stories.csv) | [02_User_Stories.xlsx](02_User_Stories.xlsx) |
| Test scenarios | [03_Test_Scenarios.md](03_Test_Scenarios.md) | [03_Test_Scenarios.csv](03_Test_Scenarios.csv) | [03_Test_Scenarios.xlsx](03_Test_Scenarios.xlsx) |
| Detailed test cases | [04_Detailed_Test_Cases.md](04_Detailed_Test_Cases.md) | [04_Detailed_Test_Cases.csv](04_Detailed_Test_Cases.csv) | [04_Detailed_Test_Cases.xlsx](04_Detailed_Test_Cases.xlsx) |
| Test data | [05_Test_Data.md](05_Test_Data.md) | [05_Test_Data.csv](05_Test_Data.csv) | [05_Test_Data.xlsx](05_Test_Data.xlsx) |
| Test execution results | [07_Test_Execution_Results.md](07_Test_Execution_Results.md) | [07_Test_Execution_Results.csv](07_Test_Execution_Results.csv) | [07_Test_Execution_Results.xlsx](07_Test_Execution_Results.xlsx) |
| Defect report | [08_Defect_Report.md](08_Defect_Report.md) | [08_Defect_Report.csv](08_Defect_Report.csv) | [08_Defect_Report.xlsx](08_Defect_Report.xlsx) |
| BUG-001 detail | [BUG-001.md](Bugs/BUG-001.md) | - | - |
| Requirement traceability | [09_Requirement_Traceability_Matrix.md](09_Requirement_Traceability_Matrix.md) | [09_Requirement_Traceability_Matrix.csv](09_Requirement_Traceability_Matrix.csv) | [09_Requirement_Traceability_Matrix.xlsx](09_Requirement_Traceability_Matrix.xlsx) |
| Final QA report | [10_Final_QA_Test_Report.md](10_Final_QA_Test_Report.md) | - | - |

To regenerate the text versions after updating the Excel workbooks:

```powershell
node QA_Deliverables/convert-xlsx-to-text.js
```
