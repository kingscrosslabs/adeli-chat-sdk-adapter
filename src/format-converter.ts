import { cardToFallbackText } from "@chat-adapter/shared";
import {
  BaseFormatConverter,
  type CardElement,
  type Content,
  parseMarkdown,
  type Root,
  tableToAscii,
} from "chat";
import { linkButtonLines } from "./cards";

/**
 * Instagram, Facebook, WhatsApp and TikTok comments all render plain text, so
 * outgoing markdown is flattened: emphasis markers are dropped, links become
 * `text (url)`, and list items start with `- `. Incoming text is parsed as
 * markdown with the default incoming parse limits.
 */
export class AdeliFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) => this.nodeToText(node));
  }

  /** A card's title, subtitle, text and fields as plain text, without its buttons. */
  cardBodyText(card: CardElement): string {
    return this.fromMarkdown(cardToFallbackText(card, { boldFormat: "**" }));
  }

  /** Plain-text card fallback for platforms without buttons: the body, then `label: url` per link button. */
  override cardToFallbackText(card: CardElement): string {
    return [this.cardBodyText(card), ...linkButtonLines(card)].filter((line) => line !== "").join("\n");
  }

  private children(node: { children?: Content[] }): string {
    return (node.children ?? []).map((child) => this.nodeToText(child)).join("");
  }

  private nodeToText(node: Content): string {
    switch (node.type) {
      case "text":
      case "inlineCode":
      case "code":
        return node.value;
      case "paragraph":
      case "heading":
      case "strong":
      case "emphasis":
      case "delete":
        return this.children(node);
      case "break":
        return "\n";
      case "thematicBreak":
        return "---";
      case "link": {
        const label = this.children(node);
        return label === "" || label === node.url ? node.url : `${label} (${node.url})`;
      }
      case "image":
        return node.alt ? `${node.alt} (${node.url})` : node.url;
      case "list":
        return this.renderList(node, 0, (child) => this.nodeToText(child), "-");
      case "blockquote":
        return (node.children ?? [])
          .map((child) => this.nodeToText(child))
          .join("\n")
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
      case "table":
        return tableToAscii(node);
      default:
        return this.defaultNodeToText(node, (child) => this.nodeToText(child));
    }
  }
}
