import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import { AdeliFormatConverter } from "./format-converter";

const converter = new AdeliFormatConverter();
const flatten = (markdown: string) => converter.fromMarkdown(markdown);

describe("AdeliFormatConverter.toAst", () => {
  it("parses plain text", () => {
    const ast = converter.toAst("Hello world");
    expect(ast.type).toBe("root");
    expect(converter.extractPlainText("Hello world")).toBe("Hello world");
  });

  it("parses markdown emphasis", () => {
    const paragraph = converter.toAst("**bold**").children[0] as { children: { type: string }[] };
    expect(paragraph.children[0]?.type).toBe("strong");
  });

  it("parses incoming text into text and AST", () => {
    const parsed = converter.parseIncoming("hey *you*");
    expect(parsed.text).toBe("hey you");
    expect(parsed.formatted.type).toBe("root");
  });
});

describe("AdeliFormatConverter.fromAst flattens to plain text", () => {
  it("drops emphasis, strong, strikethrough and code markers", () => {
    expect(flatten("**bold** _it_ ~~gone~~ `code`")).toBe("bold it gone code");
  });

  it("renders links as text (url)", () => {
    expect(flatten("[our shop](https://shop.example.com)")).toBe("our shop (https://shop.example.com)");
    expect(flatten("<https://shop.example.com>")).toBe("https://shop.example.com");
  });

  it("renders lists with dashes", () => {
    expect(flatten("* one\n* two")).toBe("- one\n- two");
    expect(flatten("1. first\n2. second")).toContain("first");
  });

  it("keeps headings, paragraphs and code blocks as text", () => {
    expect(flatten("# Title\n\nBody")).toBe("Title\n\nBody");
    expect(flatten("```\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("renders blockquotes, breaks, rules and images", () => {
    expect(flatten("> quoted")).toBe("> quoted");
    expect(flatten("line one  \nline two")).toBe("line one\nline two");
    expect(flatten("---")).toBe("---");
    expect(flatten("![logo](https://cdn.example.com/l.png)")).toBe("logo (https://cdn.example.com/l.png)");
    expect(flatten("![](https://cdn.example.com/l.png)")).toBe("https://cdn.example.com/l.png");
  });

  it("renders tables as ASCII", () => {
    const out = flatten("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toContain("a");
    expect(out).toContain("2");
  });
});

describe("AdeliFormatConverter.renderPostable", () => {
  const card: CardElement = {
    type: "card",
    title: "Your order",
    subtitle: "#42",
    children: [
      { type: "text", content: "It **ships** today." },
      { type: "fields", children: [{ type: "field", label: "Total", value: "$10" }] },
      {
        type: "actions",
        children: [
          { type: "button", id: "ok", label: "OK" },
          { type: "link-button", label: "Track", url: "https://example.com/t" },
        ],
      },
    ],
  };

  it("passes plain strings through", () => {
    expect(converter.renderPostable("Hello *raw*")).toBe("Hello *raw*");
    expect(converter.renderPostable({ raw: "raw text" })).toBe("raw text");
  });

  it("flattens markdown", () => {
    expect(converter.renderPostable({ markdown: "Hello **world**" })).toBe("Hello world");
  });

  it("renders an AST", () => {
    expect(converter.renderPostable({ ast: converter.toAst("_hi_") })).toBe("hi");
  });

  it("falls back to plain text for a card, keeping link-button URLs", () => {
    const text = converter.renderPostable({ card });
    expect(text).toBe("Your order\n#42\nIt ships today.\nTotal: $10\nTrack: https://example.com/t");
    expect(converter.renderPostable(card)).toBe(text);
  });

  it("uses an explicit card fallbackText", () => {
    expect(converter.renderPostable({ card, fallbackText: "See your order" })).toBe("See your order");
  });

  it("renders a card body without buttons", () => {
    expect(converter.cardBodyText(card)).toBe("Your order\n#42\nIt ships today.\nTotal: $10");
  });
});
