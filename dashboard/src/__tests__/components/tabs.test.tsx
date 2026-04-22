// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

describe("Tabs", () => {
  test("works with stable string values", () => {
    render(
      <Tabs defaultValue="alpha">
        <TabsList>
          <TabsTrigger value="alpha">Alpha</TabsTrigger>
          <TabsTrigger value="beta">Beta</TabsTrigger>
        </TabsList>
        <TabsContent value="alpha">Alpha panel</TabsContent>
        <TabsContent value="beta">Beta panel</TabsContent>
      </Tabs>
    );

    const alphaTab = screen.getByRole("tab", { name: "Alpha" });
    const betaTab = screen.getByRole("tab", { name: "Beta" });

    expect(alphaTab.getAttribute("aria-selected")).toBe("true");
    expect(betaTab.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(betaTab);

    expect(alphaTab.getAttribute("aria-selected")).toBe("false");
    expect(betaTab.getAttribute("aria-selected")).toBe("true");
  });
});
