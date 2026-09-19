import assert from "node:assert/strict";
import test from "node:test";

import { submissionIssueFromError } from "./intake.ts";

test("incomplete applicant data names missing fields and points to step 2", () => {
  const issue = submissionIssueFromError(
    { code: "APPLICANT_DATA_INCOMPLETE", message: "申請資料尚未填寫完整：聯絡電話、出生日期" },
    ["聯絡電話", "出生日期"],
    [],
  );

  assert.deepEqual(issue.missing, ["聯絡電話", "出生日期"]);
  assert.equal(issue.target, "details");
  assert.match(issue.action, /步驟 2/);
  assert.match(issue.action, /儲存申請資料/);
});

test("missing documents fall back to the server message and point to step 3", () => {
  const issue = submissionIssueFromError(
    { code: "DOCUMENTS_INCOMPLETE", message: "文件尚未齊全：存摺封面影本、切結書" },
    [],
    [],
  );

  assert.deepEqual(issue.missing, ["存摺封面影本", "切結書"]);
  assert.equal(issue.target, "documents");
  assert.match(issue.action, /步驟 3/);
});

test("temporary source review failures tell the user not to re-enter saved data", () => {
  const issue = submissionIssueFromError(
    { code: "SOURCE_REVIEW_UNAVAILABLE", message: "無法完成資料比對，請稍後再試。" },
    [],
    [],
  );

  assert.equal(issue.target, "review");
  assert.match(issue.action, /資料不需重填/);
  assert.match(issue.action, /重新檢查/);
});
