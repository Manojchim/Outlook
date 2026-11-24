const ExcelJS = require("exceljs");
const path = require("node:path");

const outDir = __dirname;
const date = "2026-11-18";

const stories = [
  ["US-001","Authentication","Secure application access","As a user, I want the app to require valid credentials, so that protected content is restricted.","App is accessible","AC-001","Valid credentials reveal the application","Implemented"],
  ["US-002","Authentication","Reject invalid credentials","As a user, I want invalid credentials rejected, so that unauthorized access is prevented.","App is accessible","AC-002","Invalid credentials show an inline error","Implemented"],
  ["US-003","Authentication","Logout and session cleanup","As a signed-in user, I want logout to clear protected state, so that my session cannot continue.","User is signed in","AC-003","Logout hides the app and resets password input","Partial"],
  ["US-004","Home","Location search and forecast","As a commuter, I want to select a location and see live weather, so that I can plan footwear.","Weather providers are reachable","AC-004","Valid location loads live weather","Implemented"],
  ["US-005","Home","Commute recommendations","As a commuter, I want Bike/Cycle/Car filtering, so that my shoe choice fits the route.","A forecast is loaded","AC-005","Each commute produces weather and terrain matches","Implemented"],
  ["US-006","Collection","Browse the 40-model catalogue","As a shopper, I want to browse 40 unique shoes with UK size 8, so that I can compare options.","User is authenticated","AC-006","Collection displays 40 unique shoe cards","Implemented"],
  ["US-007","Brands","Browse by brand","As a shopper, I want brand counts and brand filtering, so that I can navigate the catalogue.","Collection is open","AC-007","15 brands are listed and brand filters show matching models","Implemented"],
  ["US-008","Shoe Details","View shoe details and variants","As a shopper, I want details, variants, pros and cons, so that I can assess a shoe.","A shoe card is visible","AC-008","Details show description, fit, weather, terrain and variants","Implemented"],
  ["US-009","Running","Configure a running recommendation","As a runner, I want distance and running type filtering, so that shoes match my run.","Location weather and distance are selected","AC-009","Running range 1-42 km and seven running types are available","Implemented"],
  ["US-010","Image Management","Protect image publication","As an administrator, I want unverified images excluded and access protected, so that licensing is respected.","Server admin token is configured","AC-010","Public API returns only verified images; protected API requires a bearer token","Implemented"],
  ["US-011","General","Handle external-service failures","As a user, I want clear failures and loading states, so that I understand unavailable integrations.","App is accessible","AC-011","Geocoding/weather failures show actionable status text","Implemented"]
];

const testColumns = [
  "Test Case ID","User Story ID","Acceptance Criteria ID","Module","Sub Module","Test Scenario ID","Test Scenario",
  "Test Case Title","Test Type","Test Design Technique","Priority","Severity","Preconditions","Test Data","Test Environment",
  "Test Steps","Expected Result","Actual Result","Execution Status","Defect ID","Automation Status","Evidence Reference",
  "Executed By","Execution Date","Remarks"
];

const cases = [
  ["TC-001","US-001","AC-001","Authentication","Login","TS-001","Valid login","Valid credentials open application","Positive","Equivalence Partitioning","Critical","High","Login page is accessible","admin / admin","Local Chromium","1. Open application. 2. Enter admin. 3. Enter admin. 4. Submit.","Application shell and welcome label become visible.","Application shell and welcome label were visible.","Pass","N/A","Automated","Playwright: tests/stride.spec.js","Playwright","2026-11-18","Baseline pass"],
  ["TC-002","US-002","AC-002","Authentication","Login","TS-002","Invalid login","Incorrect password is rejected","Negative","Error Guessing","High","Medium","Login page is accessible","admin / wrong","Local Chromium","1. Open app. 2. Enter valid username and wrong password. 3. Submit.","Inline error appears and app shell remains hidden.","Inline error appeared and app shell remained hidden.","Pass","N/A","Automated","Playwright: tests/stride.spec.js","Playwright","2026-11-18","Baseline pass"],
  ["TC-003","US-002","AC-002","Authentication","Login","TS-003","SQL/XSS payload","Payload credentials are rejected","Security","Error Guessing","Critical","High","Login page is accessible","' OR '1'='1 / <script>alert(1)</script>","Local Chromium","1. Enter payload username/password. 2. Submit.","Rejected with no unauthorized access or script rendering.","Rejected; app shell remained hidden and payload was not rendered.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18","Safe payload test"],
  ["TC-004","US-003","AC-003","Authentication","Session","TS-004","Session bypass","Browser state alone exposes app","Security","State Transition","Critical","Critical","Login page is accessible","sessionStorage key stride-demo-authenticated=true","Local Chromium","1. Open app. 2. Set sessionStorage key. 3. Reload.","Protected UI should require server/session validation.","Setting browser storage exposed the full application without login.","Fail","BUG-001","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18","Security acceptance criterion failed"],
  ["TC-005","US-003","AC-003","Authentication","Logout","TS-005","Logout cleanup","Logout removes session state","Positive","State Transition","Critical","High","User is logged in","No extra data","Local Chromium","1. Log in. 2. Log out. 3. Reload.","Login screen remains visible after reload.","Login screen remained visible and app shell remained hidden.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-006","US-003","AC-003","Authentication","Password","TS-006","Password masking","Password field masks input","UI","Exploratory","Medium","Low","Login page is accessible","admin","Local Chromium","1. Open login. 2. Inspect password input type.","Password field type is password.","Password field type was password.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-007","US-001","AC-001","Authentication","Required fields","TS-007","Mandatory fields","Empty login submission is prevented","Negative","BVA","Medium","Medium","Login page is accessible","Empty username/password","Local Chromium","1. Open app. 2. Submit without values. 3. Submit with username only.","Browser required validation prevents submission.","Required fields prevented submission and app stayed hidden.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-008","US-004","AC-004","Home","Location search","TS-008","No location matches","No-match geocoding response","Negative","Error Guessing","High","Medium","Authenticated app","zzzz-no-place","Local Chromium","1. Search unknown place. 2. Wait for response.","No-match status is displayed and commute stays hidden.","No-match status was displayed and commute remained hidden.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-009","US-004","AC-004","Home","Location search","TS-009","Geocoding failure","503 geocoding response","Integration","Error Guessing","High","High","Authenticated app","London","Local Chromium","1. Mock 503. 2. Search London.","Actionable location search failure is shown.","Location search failed status was shown.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-010","US-011","AC-011","Home","Weather API","TS-010","Weather timeout","504 weather response","Edge Case","Error Guessing","High","High","Authenticated app","London","Local Chromium","1. Select London. 2. Mock 504 weather response.","WEATHER UNAVAILABLE is displayed with retry guidance.","WEATHER UNAVAILABLE and lookup failed status were shown.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-011","US-005","AC-005","Home","Commute","TS-011","Commute choices","Bike/Cycle/Car recommendations","Functional","Decision Table","High","Medium","Mock valid London weather","Bike, Cycle, Car","Local Chromium","1. Select London. 2. Select each commute.","Cards and selection summary update for each commute.","Cards and selection summary updated for Bike, Cycle, and Car.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-012","US-006","AC-006","Collection","Catalogue","TS-012","Catalogue size","40 unique models","Functional","Equivalence Partitioning","Critical","High","Authenticated app","All shoes","Local Chromium","1. Open Collection. 2. Count cards.","Exactly 40 unique models are displayed.","Exactly 40 models were displayed.","Pass","N/A","Automated","tests/stride.spec.js","Playwright","2026-11-18",""],
  ["TC-013","US-006","AC-006","Collection","Search","TS-013","Model search","Exact and no-match search","Functional","Equivalence Partitioning","High","Medium","Collection view","Nike P-6000 / XSS payload","Local Chromium","1. Search exact model. 2. Search payload. 3. Clear.","Exact returns one; no-match returns zero; clear restores 40.","Exact one, no-match zero, clear 40; payload was not rendered.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-014","US-007","AC-007","Brands","Brand directory","TS-014","Brand count","15 brands and ASICS 4 models","Functional","Equivalence Partitioning","High","Medium","Collection view","ASICS","Local Chromium","1. Open Brands. 2. Count cards. 3. Select ASICS. 4. Reset.","15 brand cards appear; ASICS shows 4; reset shows 40.","15 brands, ASICS 4 models, reset 40.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-015","US-008","AC-008","Shoe Details","Details modal","TS-015","Details","Variant and product details","Functional","Exploratory","High","Medium","Collection card visible","Gel-Nimbus 27","Local Chromium","1. Open pending shoe details. 2. Change variant. 3. Close.","Modal shows placeholder, colour, fit, pros and cons.","Placeholder and variant details displayed correctly.","Pass","N/A","Automated","tests/stride.spec.js","Playwright","2026-11-18",""],
  ["TC-016","US-009","AC-009","Running","Distance","TS-016","Distance BVA","Minimum and maximum enforcement","BVA","BVA","High","Medium","Running view loaded","0, 1, 42, 43 km","Local Chromium","1. Set 0. 2. Set 43.","UI clamps 0 to 1 and 43 to 42.","0 displayed as 1 km; 43 displayed as 42 km.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-017","US-009","AC-009","Running","Running types","TS-017","Running combinations","Distance/type/weather filtering","Functional","Decision Table","High","Medium","Mock sunny London weather","1 km Daily / 42 km Marathon / 10 km Trail","Local Chromium","1. Select each distance and type.","Suitable cards appear and casual/training shoes are excluded per rules.","Suitable cards appeared for all three combinations and casual shoes were excluded.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-018","US-009","AC-009","Running","No matches","TS-018","No matching shoes","Valid selection with no catalogue match","Negative","Decision Table","Medium","Medium","Running view loaded","Rainy, 42 km, Marathon","Local Chromium","1. Mock rainy weather. 2. Set 42 km. 3. Select Marathon.","Empty-state text explains no matches.","Empty-state behavior was observed during a fixture-debug run, but no dedicated assertion was included.","Not Run","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18","Add a dedicated assertion for this scenario"],
  ["TC-019","US-010","AC-010","Image Management","Authorization","TS-019","Missing/wrong token","Admin endpoints reject unauthorized access","Security","Error Guessing","Critical","High","Admin APIs configured","Missing token / wrong-token","Local Chromium","1. POST discovery without token. 2. Repeat with wrong token.","401 is returned for both requests.","401 returned for missing and wrong tokens.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-020","US-010","AC-010","Image Management","Public API","TS-020","Pending images hidden","Public API excludes unverified candidates","Security","Boundary Analysis","Critical","High","Fresh test database","No verified images","Local Chromium","1. GET public product-images.","Empty array is returned and pending candidates stay hidden.","Public API returned an empty array.","Pass","N/A","Automated","tests/image-service.spec.js","Playwright","2026-11-18",""],
  ["TC-021","US-010","AC-010","Image Management","Static exposure","TS-021","Source files hidden","Sensitive server files not public","Security","Error Guessing","High","High","Local server","/server.js / .env.example / package.json","Local Chromium","1. Request sensitive paths. 2. Inspect app.js.","Sensitive paths return 404 and app.js contains no token.","Server and environment paths returned 404; app.js no test token.","Pass","N/A","Automated","tests/qa/end-to-end.spec.js","Playwright","2026-11-18",""],
  ["TC-022","US-010","AC-010","Image Management","Candidate verification","TS-022","Verify image","Exact match, valid angle, reuse metadata","Negative","Decision Table","High","High","Image record ID 1 absent","confirmed=true, angle=Front","Local Chromium","1. POST verify with valid token.","404 or 422 occurs; no unauthorized publish.","404 returned because no candidate existed.","Pass","N/A","Automated","tests/image-service.spec.js","Playwright","2026-11-18",""],
  ["TC-023","US-011","AC-011","General","Responsive UI","TS-023","Mobile viewport","375px layout does not overflow","UI","Exploratory","Medium","Low","Authenticated app","375x812","Local Chromium","1. Set 375x812. 2. Inspect document width.","Document scroll width is no greater than viewport.","375px layout passed existing tests.","Pass","N/A","Automated","tests/stride.spec.js","Playwright","2026-11-18",""],
  ["TC-024","US-011","AC-011","General","Console/network","TS-024","Browser console and network","No unexpected console/network failures","Regression","Exploratory","Medium","Medium","Full application","Normal flows","Local Chromium","1. Exercise major flows. 2. Review console/network.","No unexpected application console errors.","Not instrumented by dedicated assertions; existing suite generated no reported failures.","Not Run","N/A","Manual","None","Automation/Manual","2026-11-18","Needs console listener in QA suite"],
  ["TC-025","US-011","AC-011","General","Database persistence","TS-025","Catalog sync","Catalogue persisted across restarts","Data Validation","Exploratory","High","Medium","Writable test DB","40 models","Local","1. Sync catalog. 2. Restart server. 3. Query DB.","Valid catalog remains consistent after restart.","Not executed as a standalone test.","Not Run","N/A","Manual","None","Tester","2026-11-18","Temporary Playwright DB reused per run"],
  ["TC-026","US-010","AC-010","Image Management","Broken URLs","TS-026","Broken image placeholder","Missing/broken URL handling","Edge Case","Error Guessing","Medium","Low","Shoe has missing gallery","Missing/broken URL","Local Chromium","1. Open missing image shoe. 2. Trigger broken URL.","Placeholder appears without broken-image icon.","Not executed as dedicated test.","Not Run","N/A","Manual","None","Tester","2026-11-18","Existing suite checks placeholders"],
  ["TC-027","US-010","AC-010","Image Management","External provider","TS-027","Provider timeout","Wikimedia/Amazon/feeds unavailable","Integration","Error Guessing","High","High","Admin token configured","503/timeout provider response","Local Chromium","1. Trigger discovery. 2. Observe provider status.","Discovery reports error and leaves candidates unpublished.","Not executed with a controlled external provider mock.","Blocked","N/A","Not Automatable","None","Automation/Tester","2026-11-18","External providers may require credentials"],
  ["TC-028","US-005","AC-005","Home","Weather/rankings","TS-028","Rapid commute changes","Multiple rapid selections","Edge Case","State Transition","Medium","Low","Forecast loaded","Bike, Cycle, Car rapid clicks","Local Chromium","1. Rapidly change commute options.","Final commute wins and recommendations remain consistent.","Not executed as dedicated test.","Not Run","N/A","Automated","None","Automation","2026-11-18","Suitable for future automation"],
  ["TC-029","US-009","AC-009","Running","Refresh","TS-029","Refresh during loading","Reload while weather request pending","Edge Case","State Transition","Medium","Medium","Delayed mocked weather","Slow network","Local Chromium","1. Start weather load. 2. Refresh.","Stale request cannot update stale view; app returns to initial state.","Not executed as dedicated test.","Not Run","N/A","Automated","None","Automation","2026-11-18","Requires deterministic route delay"],
  ["TC-030","US-011","AC-011","General","Browser compatibility","TS-030","Cross-browser run","Chromium, Firefox, WebKit","Regression","Exploratory","Medium","Medium","Supported Playwright browsers","Desktop and mobile profiles","Local","1. Run suite under available browsers.","Supported browser flows execute consistently.","Only Chromium was configured and executed.","Not Applicable","N/A","Automated","None","Automation","2026-11-18","Firefox/WebKit not configured"]
];

async function writeWorkbook(fileName, sheets) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GitHub Copilot QA";
  workbook.created = new Date();
  for (const sheetSpec of sheets) {
    const sheet = workbook.addWorksheet(sheetSpec.name);
    sheet.addTable({ name: sheetSpec.tableName || `Table${sheetSpec.name.replace(/[^A-Za-z0-9]/g, "")}`, ref: "A1", headerRow: true, totalsRow: false, style: { theme: "TableStyleMedium2", showRowStripes: true }, columns: sheetSpec.columns.map((c) => ({ name: c })), rows: sheetSpec.rows });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + sheetSpec.columns.length)}1` };
    sheet.columns.forEach((column) => { column.width = Math.max(12, Math.min(45, column.header?.length || 12)); });
  }
  await workbook.xlsx.writeFile(path.join(outDir, fileName));
}

(async () => {
  await writeWorkbook("02_User_Stories.xlsx", [{ name: "User Stories", columns: ["User Story ID","Module","User Story Title","User Story Description","Preconditions","Acceptance Criteria ID","Acceptance Criteria","Implementation Status"], rows: stories }]);

  const scenarios = cases.map((c) => [c[5], c[1], c[2], c[3], c[4], c[6], c[8], c[9]]);
  await writeWorkbook("03_Test_Scenarios.xlsx", [{ name: "Test Scenarios", columns: ["Test Scenario ID","User Story ID","Acceptance Criteria ID","Module","Sub Module","Scenario","Test Type","Test Design Technique"], rows: scenarios }]);

  await writeWorkbook("04_Detailed_Test_Cases.xlsx", [{ name: "Detailed Test Cases", columns: testColumns, rows: cases }]);

  const testData = [
    ["TD-001","Credentials","Valid login","username=admin; password=admin","Secure local test data","Used"],
    ["TD-002","Credentials","Invalid login","username=admin; password=wrong","Safe test data","Used"],
    ["TD-003","Security","SQL injection payload","' OR '1'='1","Safe approved payload","Used"],
    ["TD-004","Security","XSS payload","<script>alert(1)</script>","Safe approved payload","Used"],
    ["TD-005","Location","Valid location","London, Greater London, United Kingdom","Mocked Open-Meteo","Used"],
    ["TD-006","Location","Invalid location","zzzz-no-place","Mocked empty results","Used"],
    ["TD-007","Weather","Rain","weather_code=61","Mocked API","Used"],
    ["TD-008","Weather","Sunny","weather_code=1","Mocked API","Used"],
    ["TD-009","Running","Minimum distance","1 km","Slider boundary","Used"],
    ["TD-010","Running","Maximum distance","42 km","Slider boundary","Used"],
    ["TD-011","Running","Running types","Daily, Short, Long, Marathon, Trail, Sprint, Treadmill","Actual select values","Used"],
    ["TD-012","Collection","Brands/models","15 brands / 40 models","Actual catalog","Used"],
    ["TD-013","Images","Missing/broken","Pending variants and broken URLs","No images verified","Used partially"],
    ["TD-014","API","Invalid responses","503, 504, empty JSON","Mocked provider responses","Used"]
  ];
  await writeWorkbook("05_Test_Data.xlsx", [{ name: "Test Data", columns: ["Test Data ID","Category","Purpose","Exact Value","Handling","Status"], rows: testData }]);

  const execution = cases.map((c) => c);
  await writeWorkbook("07_Test_Execution_Results.xlsx", [{ name: "Execution Results", columns: testColumns, rows: execution }]);

  const defects = [
    ["BUG-001","TC-004","US-003","Authentication","Client-side session storage allows authentication bypass","Windows 11 / Chromium / Local","Critical","P1","Application is open; browser has no valid session","1. Open the application. 2. Set sessionStorage stride-demo-authenticated=true. 3. Reload.","Login must remain required and protected UI/APIs must remain unavailable.","2026-11-19 retest failed: application shell, Welcome Manoj and navigation became visible without credentials.","tests/qa/end-to-end.spec.js; targeted and full-suite Playwright retest; QA_Deliverables/Bugs/BUG-001.md","Retest","Reproducible authentication bypass. No fix was applied."],
    ["BUG-002","TC-024","US-011","General / Automation","test-1.spec.js points to another workspace and has no assertions","Windows 11 / Chromium / Local","Medium","P3","Existing suite","Run test-1.spec.js","Test should use baseURL and assert behavior","2026-11-19 retest passed Playwright despite stale file URL and no assertions.","tests/test-1.spec.js; standalone and full-suite retests","Retest","Automation maintenance defect remains unresolved."],
    ["BUG-003","US-002","US-002","Authentication","Credentials are hardcoded in frontend","Windows 11 / Chromium / Local","High","P2","Application source","Inspect app.js or bypass login","Credentials must be server-controlled and secrets not shipped to browser","2026-11-19 source retest found admin/admin comparison unchanged.","app.js login handler source review","Retest","Demo credential remains in frontend. No fix was applied."]
  ];
  await writeWorkbook("08_Defect_Report.xlsx", [{ name: "Defects", columns: ["Defect ID","Related Test Case ID","User Story ID","Module","Defect Title","Environment","Severity","Priority","Preconditions","Steps to Reproduce","Expected Result","Actual Result","Evidence","Status","Remarks"], rows: defects }]);

  const rtm = [
    ["US-001","AC-001","Valid login opens app","TC-001, TC-007","2","2","0","0","Covered",""],
    ["US-002","AC-002","Invalid credentials and payloads rejected","TC-002, TC-003","2","2","0","0","Covered",""],
    ["US-003","AC-003","Logout/session behavior","TC-004, TC-005, TC-006","3","2","1","0","Covered","BUG-001, BUG-003"],
    ["US-004","AC-004","Location and weather","TC-008, TC-009, TC-010","3","3","0","0","Covered",""],
    ["US-005","AC-005","Commute recommendations","TC-011, TC-028","2","1","0","1","Partially Covered",""],
    ["US-006","AC-006","40-model collection","TC-012, TC-013, TC-026","3","2","0","1","Partially Covered",""],
    ["US-007","AC-007","Brand browsing","TC-014","1","1","0","0","Covered",""],
    ["US-008","AC-008","Shoe details and variants","TC-015","1","1","0","0","Covered",""],
    ["US-009","AC-009","Running configuration and boundaries","TC-016, TC-017, TC-018, TC-029","4","3","0","1","Partially Covered",""],
    ["US-010","AC-010","Image API and authorization","TC-019, TC-020, TC-021, TC-022, TC-026, TC-027","6","4","0","2","Partially Covered",""],
    ["US-011","AC-011","Failures, responsiveness and browser compatibility","TC-023, TC-024, TC-025, TC-030","4","2","0","2","Partially Covered","BUG-002"]
  ];
  await writeWorkbook("09_Requirement_Traceability_Matrix.xlsx", [{ name: "RTM", columns: ["User Story ID","Acceptance Criteria ID","Requirement Description","Test Case IDs","Total Cases","Passed","Failed","Blocked","Coverage Status","Defect IDs"], rows: rtm }]);

  console.log("Generated QA Excel workbooks in", outDir);
})();
