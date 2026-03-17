// ===================================================================
// Card style constants (from TNR_Tool.html)
// ===================================================================

export const CARD_STYLES = {
    terminology: {
        light: "rgba(191, 236, 233, 0.5)",
        border: "rgba(191, 236, 233, 1)",
        keyColor: "#2a8a85",
    },
    revision: {
        light: "rgba(251, 224, 203, 0.6)",
        border: "rgba(251, 224, 203, 1)",
    },
    notes: {
        headingBorder: "rgba(254, 158, 159, 0.6)",
        headingColor: "#6b5b95",
    },
};

// ===================================================================
// Utilities
// ===================================================================

/** Strip whitespace-only text nodes between HTML tags */
export function compactHtml(html: string): string {
    return html.replace(/>\s+</g, "><");
}

// ===================================================================
// Forward converters (plain text → styled HTML)
// ===================================================================

export function convertTerminology(input: string): string {
    if (!input.trim()) return "";

    const style = CARD_STYLES.terminology;
    let html = '<div class="term-wrapper">\n';

    if (/<[a-z][\s\S]*>/i.test(input)) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(input, "text/html");
        const listItems = doc.querySelectorAll("li");

        listItems.forEach((li) => {
            let term = "";
            let definition = "";
            let foundStrong = false;

            Array.from(li.childNodes).forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent?.trim() || "";
                    if (text && foundStrong) {
                        definition += text + " ";
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as Element;
                    const tagName = el.tagName;

                    if (tagName === "STRONG" || tagName === "B") {
                        term = (el.textContent?.trim() || "").replace(/:$/, "");
                        foundStrong = true;
                    } else if (tagName === "SPAN") {
                        const innerStrong = el.querySelector("strong, b");
                        if (innerStrong) {
                            term = (innerStrong.textContent?.trim() || "").replace(/:$/, "");
                            foundStrong = true;
                        } else {
                            const text = el.textContent?.trim() || "";
                            if (text) definition += text + " ";
                        }
                    } else {
                        const text = el.textContent?.trim() || "";
                        if (text) definition += text + " ";
                    }
                }
            });

            definition = definition.trim().replace(/^:\s*/, "");

            if (term) {
                html += `  <div style="background: ${style.light}; padding: 12px; margin-bottom: 10px; border-left: 4px solid ${style.border}; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); font-family: sans-serif;">
    <strong style="color: ${style.keyColor}; display: inline-block; margin-right: 5px;">${term}:</strong> ${definition}
  </div>\n`;
            } else if (definition) {
                html += `  <div style="background: rgba(0,0,0,0.03); padding: 12px; margin-bottom: 10px; border-radius: 4px; font-family: sans-serif;">${definition}</div>\n`;
            }
        });

        if (listItems.length === 0) {
            const paragraphs = doc.querySelectorAll("p");
            paragraphs.forEach((p) => {
                const text = p.textContent?.trim() || "";
                const colonIndex = text.indexOf(":");
                if (colonIndex > -1) {
                    const t = text.substring(0, colonIndex).trim();
                    const def = text.substring(colonIndex + 1).trim();
                    html += `  <div style="background: ${style.light}; padding: 12px; margin-bottom: 10px; border-left: 4px solid ${style.border}; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); font-family: sans-serif;">
    <strong style="color: ${style.keyColor}; display: inline-block; margin-right: 5px;">${t}:</strong> ${def}
  </div>\n`;
                }
            });
        }
    } else {
        const lines = input.split("\n").filter((l) => l.trim());
        lines.forEach((line) => {
            line = line.trim();
            const colonIndex = line.indexOf(":");
            if (colonIndex > -1) {
                const term = line.substring(0, colonIndex).trim();
                const def = line.substring(colonIndex + 1).trim();
                html += `  <div style="background: ${style.light}; padding: 12px; margin-bottom: 10px; border-left: 4px solid ${style.border}; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); font-family: sans-serif;">
    <strong style="color: ${style.keyColor}; display: inline-block; margin-right: 5px;">${term}:</strong> ${def}
  </div>\n`;
            } else {
                html += `  <div style="background: rgba(0,0,0,0.03); padding: 12px; margin-bottom: 10px; border-radius: 4px; font-family: sans-serif;">${line}</div>\n`;
            }
        });
    }

    html += "</div>";
    return compactHtml(html);
}

export function processNode(node: ChildNode): string {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node as Element;
    const tagName = el.tagName;

    if (tagName === "IMG") {
        return `<div style="margin: 20px 0; text-align: center;">
            <img src="${(el as HTMLImageElement).src}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
         </div>`;
    }

    const childrenHtml = Array.from(el.childNodes).map(processNode).join("");

    if (tagName === "UL" || tagName === "OL") {
        let listType = el.getAttribute("type");
        if (!listType) {
            listType = tagName === "UL" ? "disc" : "decimal";
        }
        return `<${tagName.toLowerCase()} style="margin-left: 20px; padding-left: 20px; margin-bottom: 25px; margin-top: 10px; list-style-type: ${listType};">${childrenHtml}</${tagName.toLowerCase()}>`;
    }

    if (tagName === "LI") {
        return `<li style="margin-bottom: 8px; padding-left: 5px;">${childrenHtml}</li>`;
    }

    if (/^H[1-6]$/.test(tagName) || tagName === "P") {
        const text = (el.textContent || "").trim();
        if (childrenHtml.includes('<div style="margin: 20px')) {
            return childrenHtml;
        }
        if (!text && !el.querySelector("img")) return "";

        const strong = el.querySelector("strong") || el.querySelector("b");
        const isBold = strong && text === (strong.textContent || "").trim();
        const isShort = text.length < 150;

        if (/^H[1-6]$/.test(tagName) || (tagName === "P" && isBold && isShort)) {
            const cleanContent = childrenHtml.replace(/<\/?strong>/g, "").replace(/<\/?b>/g, "");
            const style = CARD_STYLES.notes;
            return `<h3 style="color: ${style.headingColor}; border-bottom: 2px solid ${style.headingBorder}; padding-bottom: 5px; margin-top: 25px; margin-bottom: 15px;">${cleanContent}</h3>`;
        }

        return `<p style="margin-bottom: 15px;">${childrenHtml}</p>`;
    }

    if (["STRONG", "B", "EM", "I", "U", "SUB", "SUP", "A"].includes(tagName)) {
        let attrs = "";
        if (tagName === "A" && (el as HTMLAnchorElement).href) {
            attrs = ` href="${(el as HTMLAnchorElement).href}" target="_blank" style="color: inherit; text-decoration: underline;"`;
        }
        return `<${tagName.toLowerCase()}${attrs}>${childrenHtml}</${tagName.toLowerCase()}>`;
    }

    if (["SPAN", "FONT", "DIV", "CENTER", "SECTION", "ARTICLE"].includes(tagName)) {
        return childrenHtml;
    }

    if (tagName === "BR") return "<br>";

    return childrenHtml;
}

export function convertNotes(input: string): string {
    if (!input.trim()) return "";

    let html = '<div style="font-family: sans-serif; line-height: 1.6; color: inherit;">\n';

    if (/<[a-z][\s\S]*>/i.test(input)) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(input, "text/html");
        html += Array.from(doc.body.childNodes).map(processNode).join("");
    } else {
        const paragraphs = input.split(/\n\s*\n/);
        const style = CARD_STYLES.notes;

        paragraphs.forEach((p) => {
            p = p.trim();
            if (!p) return;

            if (p.match(/^[-•*]/) || p.match(/^\d+\./)) {
                const items = p
                    .split(/\n/)
                    .map((l) => l.trim())
                    .filter((l) => l);
                const isOrdered = p.match(/^\d+\./);
                const tag = isOrdered ? "ol" : "ul";

                html += `  <${tag} style="margin-left: 20px; padding-left: 20px; margin-bottom: 15px;">\n`;
                items.forEach((item) => {
                    const cleanItem = item.replace(/^([-•*]|\d+\.)\s*/, "");
                    if (cleanItem) {
                        html += `    <li style="margin-bottom: 5px;">${cleanItem}</li>\n`;
                    }
                });
                html += `  </${tag}>\n`;
            } else if (p.length < 100 && !p.endsWith(".")) {
                html += `  <h3 style="color: ${style.headingColor}; border-bottom: 2px solid ${style.headingBorder}; padding-bottom: 5px; margin-top: 25px; margin-bottom: 15px;">${p}</h3>\n`;
            } else {
                html += `  <p style="margin-bottom: 15px;">${p}</p>\n`;
            }
        });
    }

    html += "</div>";
    return compactHtml(html);
}

export function convertRevision(input: string): string {
    if (!input.trim()) return "";

    const style = CARD_STYLES.revision;
    let html = `<div style="background: ${style.light}; padding: 20px; border-radius: 8px; border: 1px solid ${style.border}; font-family: sans-serif;">\n`;
    html += '  <ul style="list-style-type: none; padding: 0; margin: 0;">\n';

    if (/<[a-z][\s\S]*>/i.test(input)) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(input, "text/html");
        const listItems = doc.querySelectorAll("li");

        const extractContent = (el: Element): string => {
            let result = "";
            Array.from(el.childNodes).forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    result += node.textContent || "";
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const child = node as Element;
                    const tag = child.tagName;
                    if (tag === "STRONG" || tag === "B") {
                        result += `<strong>${extractContent(child)}</strong>`;
                    } else if (tag === "EM" || tag === "I") {
                        result += `<em>${extractContent(child)}</em>`;
                    } else {
                        result += extractContent(child);
                    }
                }
            });
            return result;
        };

        listItems.forEach((li) => {
            const content = extractContent(li).trim();
            if (content) {
                html += `    <li style="position: relative; padding-left: 30px; margin-bottom: 12px; line-height: 1.5;">
      <span style="position: absolute; left: 0; top: 0;">&#x2705;</span>${content}
    </li>\n`;
            }
        });

        if (listItems.length === 0) {
            const paragraphs = doc.querySelectorAll("p");
            paragraphs.forEach((p) => {
                const text = (p.textContent || "").trim();
                if (text) {
                    html += `    <li style="position: relative; padding-left: 30px; margin-bottom: 12px; line-height: 1.5;">
      <span style="position: absolute; left: 0; top: 0;">&#x2705;</span>${text}
    </li>\n`;
                }
            });
        }
    } else {
        const lines = input.split("\n").filter((l) => l.trim());
        lines.forEach((line) => {
            const clean = line
                .replace(/^[-•*]\s*/, "")
                .replace(/^\d+\.\s*/, "")
                .trim();
            html += `    <li style="position: relative; padding-left: 30px; margin-bottom: 12px; line-height: 1.5;">
      <span style="position: absolute; left: 0; top: 0;">&#x2705;</span>${clean}
    </li>\n`;
        });
    }

    html += "  </ul>\n</div>";
    return compactHtml(html);
}

// ===================================================================
// Reverse parsers (styled HTML → editable data)
// ===================================================================

export function parseTerminologyHtml(html: string): Array<{term: string; definition: string}> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items: Array<{term: string; definition: string}> = [];

    const cards = doc.querySelectorAll('div[style*="border-left"]');
    cards.forEach((card) => {
        const strong = card.querySelector('strong');
        if (strong) {
            const term = (strong.textContent || '').replace(/:$/, '').trim();
            const clone = card.cloneNode(true) as Element;
            const strongClone = clone.querySelector('strong');
            if (strongClone) strongClone.remove();
            const definition = (clone.textContent || '').trim();
            items.push({term, definition});
        } else {
            const text = (card.textContent || '').trim();
            if (text) items.push({term: '', definition: text});
        }
    });

    return items;
}

export function parseNotesHtml(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const lines: string[] = [];

    const children = doc.body.firstElementChild?.children || doc.body.children;
    Array.from(children).forEach((el) => {
        const tag = el.tagName;
        if (tag === 'H3' || tag === 'H2' || tag === 'H1') {
            if (lines.length > 0) lines.push('');
            lines.push((el.textContent || '').trim());
        } else if (tag === 'P') {
            lines.push((el.textContent || '').trim());
        } else if (tag === 'UL' || tag === 'OL') {
            const items = el.querySelectorAll('li');
            items.forEach((li) => {
                lines.push(`- ${(li.textContent || '').trim()}`);
            });
        }
    });

    return lines.join('\n');
}

export function parseRevisionHtml(html: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items: string[] = [];

    const listItems = doc.querySelectorAll('li');
    listItems.forEach((li) => {
        const clone = li.cloneNode(true) as Element;
        const spans = clone.querySelectorAll('span');
        spans.forEach((span) => span.remove());
        const text = (clone.textContent || '').trim();
        if (text) items.push(text);
    });

    return items;
}
