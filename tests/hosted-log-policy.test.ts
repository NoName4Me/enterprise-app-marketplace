import {describe,expect,it} from "vitest";
import {allowedHostedLogLocation} from "../src/domain/hosted-log-policy";

describe("signed GitHub Actions log URLs",()=>{
  it.each([
    "https://pipelines.actions.githubusercontent.com/abc?sig=temporary",
    "https://pipelinesghubeus12.actions.githubusercontent.com/abc?token=abc",
    "https://productionresults.blob.core.windows.net/actions-results/file?sig=abc",
  ])("accepts only the expected download infrastructure: %s",url=>{
    expect(allowedHostedLogLocation(url)).toBe(true);
  });
  it.each([
    "http://pipelines.actions.githubusercontent.com/file",
    "https://pipelines.actions.githubusercontent.com.evil.example/file",
    "https://127.0.0.1/log",
    "https://169.254.169.254/latest/meta-data",
    "https://evil.blob.core.windows.net.evil.example/file",
    "https://user:secret@pipelines.actions.githubusercontent.com/file",
    "https://pipelines.actions.githubusercontent.com:8443/file",
    "/relative/log-url",
  ])("rejects untrusted redirects: %s",url=>{
    expect(allowedHostedLogLocation(url)).toBe(false);
  });
});
