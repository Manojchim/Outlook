"use strict";

module.exports = {
  ...require("./report-data.service"),
  ...require("./report-validation.service"),
  ...require("./report-generator.service"),
  writePdfReport: require("./pdf-report.service").writePdfReport,
  writeExcelReport: require("./excel-report.service").writeExcelReport
};
