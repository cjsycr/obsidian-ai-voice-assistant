// 测试 utils/vault.ts 的 getVaultBasePath
// 纯函数：接收 app 参数，返回 vault 根绝对路径
import { describe, it, expect } from "vitest";
import { getVaultBasePath } from "../../src/utils/vault";

describe("getVaultBasePath", () => {
  it("返回 adapter.getBasePath 的值", () => {
    const fakeApp = { vault: { adapter: { getBasePath: () => "/Users/x/Documents/Vault" } } } as any;
    expect(getVaultBasePath(fakeApp)).toBe("/Users/x/Documents/Vault");
  });

  it("Windows 路径用反斜杠（保持原样）", () => {
    const fakeApp = { vault: { adapter: { getBasePath: () => "C:\\Users\\x\\Vault" } } } as any;
    expect(getVaultBasePath(fakeApp)).toBe("C:\\Users\\x\\Vault");
  });

  it("adapter 缺 getBasePath 方法返回空字符串", () => {
    const fakeApp = { vault: { adapter: {} } } as any;
    expect(getVaultBasePath(fakeApp)).toBe("");
  });

  it("adapter 完全不存在（防御性）返回空字符串", () => {
    const fakeApp1 = { vault: {} } as any;
    const fakeApp2 = { vault: { adapter: undefined } } as any;
    expect(getVaultBasePath(fakeApp1)).toBe("");
    expect(getVaultBasePath(fakeApp2)).toBe("");
  });

  it("app 为 null/undefined 不崩溃", () => {
    expect(getVaultBasePath(null as any)).toBe("");
    expect(getVaultBasePath(undefined as any)).toBe("");
  });

  it("空字符串路径（用户刚开 vault）", () => {
    const fakeApp = { vault: { adapter: { getBasePath: () => "" } } } as any;
    expect(getVaultBasePath(fakeApp)).toBe("");
  });

  it("路径末尾带斜杠（正常情况）", () => {
    const fakeApp = { vault: { adapter: { getBasePath: () => "/Users/x/Vault/" } } } as any;
    expect(getVaultBasePath(fakeApp)).toBe("/Users/x/Vault/");
  });
});
