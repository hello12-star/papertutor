import test from "node:test";
import assert from "node:assert/strict";
import { createParseControl } from "../lib/parse-control.ts";

test("parse control allows only one in-flight request", () => {
  const control = createParseControl();
  const first = control.begin();
  assert.ok(first);
  assert.equal(control.busy, true);
  assert.equal(control.begin(), null);
});

test("cancel aborts the request and clears the busy state", () => {
  const control = createParseControl();
  const lease = control.begin();
  assert.ok(lease);
  control.cancel();
  assert.equal(lease.signal.aborted, true);
  assert.equal(control.busy, false);
  assert.equal(control.isCurrent(lease.id), false);
});

test("a late completion cannot release a newer request", () => {
  const control = createParseControl();
  const first = control.begin();
  assert.ok(first);
  control.cancel();
  const second = control.begin();
  assert.ok(second);
  assert.notEqual(second.id, first.id);
  assert.equal(control.complete(first.id), false);
  assert.equal(control.isCurrent(second.id), true);
  assert.equal(control.busy, true);
  assert.equal(control.complete(second.id), true);
  assert.equal(control.busy, false);
});

test("retry can begin after a completed request", () => {
  const control = createParseControl();
  const first = control.begin();
  assert.ok(first);
  assert.equal(control.complete(first.id), true);
  const retry = control.begin();
  assert.ok(retry);
  assert.notEqual(retry.id, first.id);
  assert.equal(control.complete(retry.id), true);
});
