import { setLocalStorage } from "./localStorage";

describe("localStorage Test", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should stringify and set value in localStorage", () => {
    const MOCK_EXTENSION_VERSION = "1.2.3";
    setLocalStorage("extensionVersion", MOCK_EXTENSION_VERSION);
    expect(JSON.parse(localStorage.getItem("extensionVersion") || "")).toEqual(
      MOCK_EXTENSION_VERSION,
    );
  });
});
