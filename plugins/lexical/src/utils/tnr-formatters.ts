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
    // Text Cards (CRK - Contextual Reasoning Kit)
    textCards: {
        conceptTitle: {
            emoji: '🧬', title: 'Concept',
            light: 'rgba(76, 175, 80, 0.08)', border: 'rgba(76, 175, 80, 0.5)',
        },
        criticalThinking: {
            emoji: '🧠', number: '1', title: 'Critical Thinking Element',
            light: 'rgba(33, 150, 243, 0.08)', border: 'rgba(33, 150, 243, 0.5)',
        },
        clinicalApplication: {
            emoji: '⚕️', number: '2', title: 'Clinical Application',
            light: 'rgba(255, 152, 0, 0.08)', border: 'rgba(255, 152, 0, 0.5)',
        },
        example: {
            emoji: '📋', number: '3', title: 'Example',
            light: 'rgba(156, 39, 176, 0.08)', border: 'rgba(156, 39, 176, 0.5)',
        },
        rationalization: {
            emoji: '💡', number: '4', title: 'Rationalization',
            light: 'rgba(0, 150, 136, 0.08)', border: 'rgba(0, 150, 136, 0.5)',
        },
        criticalInsight: {
            emoji: '🎯', number: '5', title: 'Critical Insight',
            light: 'rgba(233, 30, 99, 0.08)', border: 'rgba(233, 30, 99, 0.5)',
        },
    },
    // Questions Cards (Past Paper)
    questionsCards: {
        question: {
            emoji: '📌', title: 'Question',
            light: 'rgba(25, 118, 210, 0.08)', border: 'rgba(25, 118, 210, 0.5)',
        },
        answer: {
            emoji: '✍️', title: 'Answer',
            light: 'rgba(150, 150, 150, 0.05)', border: 'rgba(150, 150, 150, 0.3)',
        },
        rubric: {
            emoji: '📝', number: '1', title: 'MARKING RUBRIC & POINT BREAKDOWN',
            light: 'rgba(33, 150, 243, 0.08)', border: 'rgba(33, 150, 243, 0.5)',
        },
        mnemonics: {
            emoji: '🧠', number: '2', title: 'MNEMONICS & MEMORY AIDS',
            light: 'rgba(156, 39, 176, 0.08)', border: 'rgba(156, 39, 176, 0.5)',
        },
        examiner: {
            emoji: '👁️', number: '3', title: "EXAMINER'S PERSPECTIVE",
            light: 'rgba(255, 152, 0, 0.08)', border: 'rgba(255, 152, 0, 0.5)',
        },
        diagram: {
            emoji: '📊', number: '4', title: 'DIAGRAM / FLOWCHART',
            light: 'rgba(139, 195, 74, 0.08)', border: 'rgba(139, 195, 74, 0.5)',
        },
        revision: {
            emoji: '⚡', number: '5', title: 'QUICK REVISION BOX',
            light: 'rgba(205, 220, 57, 0.08)', border: 'rgba(205, 220, 57, 0.5)',
        },
        clinical: {
            emoji: '🏥', number: '6', title: 'CLINICAL CORRELATION',
            light: 'rgba(0, 150, 136, 0.08)', border: 'rgba(0, 150, 136, 0.5)',
        },
        structure: {
            emoji: '✍️', number: '7', title: 'ANSWER WRITING STRUCTURE',
            light: 'rgba(255, 235, 59, 0.08)', border: 'rgba(255, 235, 59, 0.5)',
        },
        variations: {
            emoji: '🔄', number: '8', title: 'EXAM VARIATIONS',
            light: 'rgba(233, 30, 99, 0.08)', border: 'rgba(233, 30, 99, 0.5)',
        },
        tips: {
            emoji: '🎯', number: '9', title: 'HIGH-YIELD EXAM TIP',
            light: 'rgba(255, 193, 7, 0.08)', border: 'rgba(255, 193, 7, 0.5)',
        },
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
    <strong style="color: ${style.keyColor}; display: inline-block; margin-right: 5px;">${term}:</strong> ${definition}</div>\n`;
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
    <strong style="color: ${style.keyColor}; display: inline-block; margin-right: 5px;">${t}:</strong> ${def}</div>\n`;
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
    <strong style="color: ${style.keyColor}; display: inline-block; margin-right: 5px;">${term}:</strong> ${def}</div>\n`;
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
        const style = CARD_STYLES.notes;
        const lines = input.split('\n');
        let inList: 'ul' | 'ol' | null = null;

        const closeList = () => {
            if (inList) {
                html += `  </${inList}>\n`;
                inList = null;
            }
        };

        const isBullet = (line: string) => /^[\s]*[-•*]\s/.test(line);
        const isOrdered = (line: string) => /^[\s]*\d+[.)]\s/.test(line);
        const isHeading = (line: string) => {
            const t = line.trim();
            // Short text, no trailing period, not a bullet
            if (t.length > 120 || t.length < 2) return false;
            if (t.endsWith('.') || t.endsWith(',')) return false;
            if (isBullet(t) || isOrdered(t)) return false;
            // Ends with colon = sub-heading
            if (t.endsWith(':')) return true;
            // Short without punctuation at end
            if (t.length < 80 && !/[.!?,;]$/.test(t)) return true;
            return false;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip empty lines
            if (!trimmed) {
                closeList();
                continue;
            }

            // Bullet list item
            if (isBullet(trimmed)) {
                if (inList !== 'ul') {
                    closeList();
                    inList = 'ul';
                    html += `  <ul style="margin-left: 20px; padding-left: 20px; margin-bottom: 15px;">\n`;
                }
                const cleanItem = trimmed.replace(/^[-•*]\s*/, '');
                html += `    <li style="margin-bottom: 5px;">${cleanItem}</li>\n`;
                continue;
            }

            // Ordered list item
            if (isOrdered(trimmed)) {
                if (inList !== 'ol') {
                    closeList();
                    inList = 'ol';
                    html += `  <ol style="margin-left: 20px; padding-left: 20px; margin-bottom: 15px;">\n`;
                }
                const cleanItem = trimmed.replace(/^\d+[.)]\s*/, '');
                html += `    <li style="margin-bottom: 5px;">${cleanItem}</li>\n`;
                continue;
            }

            closeList();

            // Heading
            if (isHeading(trimmed)) {
                html += `  <h3 style="color: ${style.headingColor}; border-bottom: 2px solid ${style.headingBorder}; padding-bottom: 5px; margin-top: 25px; margin-bottom: 15px;">${trimmed}</h3>\n`;
                continue;
            }

            // Regular paragraph
            html += `  <p style="margin-bottom: 15px;">${trimmed}</p>\n`;
        }

        closeList();
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

// ===================================================================
// Text Cards (CRK – Contextual Reasoning Kit)
// ===================================================================

const TEXT_CARD_SECTIONS = [
    'criticalThinking',
    'clinicalApplication',
    'example',
    'rationalization',
    'criticalInsight',
] as const;

const TEXT_CARD_SECTION_PATTERNS: Record<string, RegExp> = {
    criticalThinking: /Critical Thinking Element/i,
    clinicalApplication: /Clinical Application/i,
    example: /Example/i,
    rationalization: /Rationalization/i,
    criticalInsight: /Critical Insight/i,
};

export type TextCardsData = {
    conceptTitle: string;
    sections: Record<string, string>;
};

export function convertTextCards(input: string): string {
    if (!input.trim()) return '';

    const concepts = parseTextCardsInput(input);
    const styles = CARD_STYLES.textCards;
    let html = '';

    concepts.forEach((concept, index) => {
        if (index > 0) {
            html += '<div style="margin: 40px 0; border-top: 3px solid #e0e0e0;">&nbsp;</div>\n';
        }

        // Concept title card
        if (concept.conceptTitle) {
            const c = styles.conceptTitle;
            html += `<div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px 20px; border-radius: 12px; margin-bottom: 20px;">
  <h3 style="margin: 0; color: inherit;">${c.emoji} Concept ${index + 1}: ${concept.conceptTitle}</h3>
</div>\n`;
        }

        // Grid of section cards
        const hasCards = TEXT_CARD_SECTIONS.some((k) => concept.sections[k]);
        if (hasCards) {
            html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 20px;">\n`;
            TEXT_CARD_SECTIONS.forEach((key) => {
                const content = concept.sections[key];
                if (!content) return;
                const c = styles[key];
                html += `  <div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px; border-radius: 12px; min-height: 120px;">
    <h3 style="margin-top: 0; color: inherit; font-size: 14px;">${c.emoji} ${c.number}. ${c.title}</h3>
    <p style="margin: 0; font-size: 13px;">${nl2br(content)}</p>
  </div>\n`;
            });
            html += '</div>\n';
        }
    });

    return compactHtml(html);
}

function parseTextCardsInput(input: string): TextCardsData[] {
    const lines = input.split('\n').filter((l) => l.trim());
    const concepts: TextCardsData[] = [];
    let current: TextCardsData | null = null;
    let currentSection: string | null = null;
    let contentBuffer: string[] = [];

    const flushSection = () => {
        if (current && currentSection && contentBuffer.length > 0) {
            current.sections[currentSection] = contentBuffer.join(' ').trim();
        }
        contentBuffer = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();

        // Check for CONCEPT header
        const conceptMatch = trimmed.match(/^CONCEPT\s+\d+:\s*(.+)/i);
        if (conceptMatch) {
            flushSection();
            current = { conceptTitle: conceptMatch[1].trim(), sections: {} };
            concepts.push(current);
            currentSection = null;
            continue;
        }

        // Check for section headers
        let foundSection = false;
        for (const [key, pattern] of Object.entries(TEXT_CARD_SECTION_PATTERNS)) {
            if (pattern.test(trimmed)) {
                flushSection();
                if (!current) {
                    current = { conceptTitle: '', sections: {} };
                    concepts.push(current);
                }
                currentSection = key;
                foundSection = true;
                break;
            }
        }
        if (foundSection) continue;

        // Content line
        if (currentSection) {
            contentBuffer.push(trimmed);
        } else if (!current && trimmed) {
            // Treat first non-header text as concept title
            current = { conceptTitle: trimmed, sections: {} };
            concepts.push(current);
        }
    }
    flushSection();

    if (concepts.length === 0) {
        concepts.push({ conceptTitle: '', sections: {} });
    }
    return concepts;
}

export function parseTextCardsHtml(html: string): { conceptTitle: string; sections: Array<{ key: string; content: string }> }[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const concepts: { conceptTitle: string; sections: Array<{ key: string; content: string }> }[] = [];
    let current: { conceptTitle: string; sections: Array<{ key: string; content: string }> } | null = null;

    const styles = CARD_STYLES.textCards;
    const sectionEntries = TEXT_CARD_SECTIONS.map((k) => ({ key: k, title: styles[k].title }));

    const children = Array.from(doc.body.children);
    for (const el of children) {
        const text = (el.textContent || '').trim();

        // Concept title card
        if (text.match(/Concept\s*\d*:/i) && el.querySelector('h3')) {
            const h3 = el.querySelector('h3')!;
            const title = (h3.textContent || '').replace(/^.*Concept\s*\d*:\s*/i, '').trim();
            current = { conceptTitle: title, sections: [] };
            concepts.push(current);
            continue;
        }

        // Grid container
        if (el.tagName === 'DIV' && el.children.length > 1) {
            if (!current) {
                current = { conceptTitle: '', sections: [] };
                concepts.push(current);
            }
            for (const card of Array.from(el.children)) {
                const cardH3 = card.querySelector('h3');
                if (!cardH3) continue;
                const cardTitle = (cardH3.textContent || '').trim();
                const match = sectionEntries.find((e) => cardTitle.includes(e.title));
                const key = match ? match.key : 'criticalThinking';
                const clone = card.cloneNode(true) as Element;
                clone.querySelector('h3')?.remove();
                current.sections.push({ key, content: (clone.textContent || '').trim() });
            }
        }
    }

    return concepts;
}

// ===================================================================
// Questions Cards (Past Paper)
// ===================================================================

const QUESTIONS_CARD_GRID_SECTIONS = [
    'rubric', 'mnemonics', 'examiner', 'diagram', 'revision',
    'clinical', 'structure', 'variations', 'tips',
] as const;

const QUESTIONS_SECTION_PATTERNS: Record<string, RegExp> = {
    question: /^(\d+\.\s*)?Q(uestion|\d+)\s*[\s.:]/i,
    answer: /^(Model\s+)?Answer:\s*/i,
    rubric: /^(\d+\.\s*)?MARKING\s+RUBRIC/i,
    mnemonics: /^(\d+\.\s*)?MNEMONIC/i,
    examiner: /^(\d+\.\s*)?EXAMINER/i,
    diagram: /^(\d+\.\s*)?(DIAGRAM|FLOWCHART)/i,
    revision: /^(\d+\.\s*)?QUICK\s+REVISION/i,
    clinical: /^(\d+\.\s*)?CLINICAL/i,
    structure: /^(\d+\.\s*)?ANSWER\s+WRITING/i,
    variations: /^(\d+\.\s*)?EXAM\s+VARIATION/i,
    tips: /^(\d+\.\s*)?(HIGH-YIELD|EXAM\s+TIP)/i,
};

// Format MCQ options: splits "question text a) opt1 b) opt2..." into question + styled option list
function formatMcqQuestion(text: string): string {
    // Match options like a) b) c) d) or A) B) etc.
    const optionMatch = text.match(/\s+[a-eA-E][)]\s/);
    if (!optionMatch || optionMatch.index === undefined) return text;

    const questionPart = text.substring(0, optionMatch.index).trim();
    const optionsPart = text.substring(optionMatch.index).trim();

    // Split into individual options
    const options = optionsPart.split(/(?=\s*[a-eA-E][)]\s)/).map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) return text;

    let optionsHtml = '<div style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">';
    options.forEach((opt) => {
        const letter = opt.charAt(0).toUpperCase();
        const optText = opt.replace(/^[a-eA-E][)]\s*/, '').trim();
        optionsHtml += `<div style="display: flex; align-items: baseline; gap: 8px;">
      <span style="background: rgba(0,0,0,0.08); border-radius: 4px; padding: 2px 8px; font-weight: 600; font-size: 13px; min-width: 24px; text-align: center;">${letter}</span>
      <span style="font-size: 14px;">${optText}</span>
    </div>`;
    });
    optionsHtml += '</div>';

    return `${questionPart}${optionsHtml}`;
}

// Format MCQ answer: highlights the correct option letter
function formatMcqAnswer(text: string): string {
    // Match pattern like "d) explanation text"
    const match = text.match(/^([a-eA-E])[)]\s*/);
    if (!match) return text;
    const letter = match[1].toUpperCase();
    const explanation = text.substring(match[0].length).trim();
    return `<span style="background: rgba(76, 175, 80, 0.15); border: 1px solid rgba(76, 175, 80, 0.4); border-radius: 4px; padding: 2px 8px; font-weight: 700; font-size: 14px; margin-right: 8px;">${letter}</span> ${explanation}`;
}

// Convert newlines in content to <br> for HTML rendering
function nl2br(text: string): string {
    return text.replace(/\n/g, '<br>');
}

export function convertQuestionsCards(input: string): string {
    if (!input.trim()) return '';

    const parsed = parseQuestionsInput(input);
    const styles = CARD_STYLES.questionsCards;
    let html = '';

    // Render each Q&A pair with its own sections
    parsed.qaPairs.forEach((qa, idx) => {
        // Question card (full-width)
        if (qa.question) {
            const c = styles.question;
            const qLabel = parsed.qaPairs.length > 1 ? `Question ${idx + 1}` : 'Question';
            const formattedQ = formatMcqQuestion(nl2br(qa.question));
            html += `<div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px 20px; border-radius: 12px; margin-bottom: 20px;">
  <h3 style="margin: 0; color: inherit;">${c.emoji} ${qLabel}</h3>
  <div style="margin-top: 8px; color: inherit;">${formattedQ}</div>
</div>\n`;
        }

        // Answer card (full-width)
        if (qa.answer) {
            const c = styles.answer;
            const formattedA = formatMcqAnswer(nl2br(qa.answer));
            html += `<div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px 20px; border-radius: 12px; margin-bottom: 20px;">
  <h3 style="margin-top: 0; color: inherit;">${c.emoji} ${c.title}</h3>
  <p>${formattedA}</p>
</div>\n`;
        }

        // Grid layout for this Q&A's sections
        const qaSections = qa.sections || {};
        const hasGridCards = QUESTIONS_CARD_GRID_SECTIONS.some((k) => qaSections[k]);
        if (hasGridCards) {
            html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 8px; margin-bottom: 24px;">\n`;
            QUESTIONS_CARD_GRID_SECTIONS.forEach((key) => {
                const content = qaSections[key];
                if (!content) return;
                const c = styles[key];
                html += `  <div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px; border-radius: 12px; min-height: 120px;">
    <h3 style="margin-top: 0; color: inherit; font-size: 14px;">${c.emoji} ${c.number}. ${c.title}</h3>
    <p style="margin: 0; font-size: 13px;">${nl2br(content)}</p>
  </div>\n`;
            });
            html += '</div>\n';
        }
    });

    return compactHtml(html);
}

interface ParsedQAPair {
    question: string;
    answer: string;
    sections: Record<string, string>;
}

interface ParsedQuestions {
    qaPairs: ParsedQAPair[];
}

// Inline answer markers that split a single line into question + answer
const INLINE_ANSWER_PATTERNS = [
    /\s+Correct\s+Answer:\s*/i,
    /\s+Model\s+Answer:\s*/i,
];

// MCQ numbered line: starts with "1." or "1)" but NOT "1. Question:"
const MCQ_LINE_PATTERN = /^\d+[.)]\s+/;

function parseQuestionsInput(input: string): ParsedQuestions {
    const lines = input.split('\n').filter((l) => l.trim());
    const result: ParsedQuestions = { qaPairs: [] };
    let currentSection: string | null = null;
    let contentBuffer: string[] = [];
    let currentQA: ParsedQAPair = { question: '', answer: '', sections: {} };
    let inQASection: 'question' | 'answer' | null = null;

    const flushQA = () => {
        if (inQASection === 'question') {
            currentQA.question = contentBuffer.join('\n').trim();
        } else if (inQASection === 'answer') {
            currentQA.answer = contentBuffer.join('\n').trim();
        }
        contentBuffer = [];
    };

    const flushSection = () => {
        if (currentSection && contentBuffer.length > 0) {
            // Attach section to the current Q&A pair
            currentQA.sections[currentSection] = contentBuffer.join('\n').trim();
        }
        contentBuffer = [];
    };

    const pushCurrentQA = () => {
        if (currentQA.question || currentQA.answer || Object.keys(currentQA.sections).length > 0) {
            result.qaPairs.push({ ...currentQA, sections: { ...currentQA.sections } });
            currentQA = { question: '', answer: '', sections: {} };
        }
    };

    // Try to split a line at an inline answer marker (Correct Answer: / Model Answer:)
    const trySplitInline = (line: string): { question: string; answer: string } | null => {
        for (const pattern of INLINE_ANSWER_PATTERNS) {
            const match = line.match(pattern);
            if (match && match.index !== undefined) {
                return {
                    question: line.substring(0, match.index).trim(),
                    answer: line.substring(match.index + match[0].length).trim(),
                };
            }
        }
        return null;
    };

    for (const line of lines) {
        const trimmed = line.trim();

        // Check for question header (e.g., "1. Question:" or "Question:")
        if (QUESTIONS_SECTION_PATTERNS.question.test(trimmed)) {
            if (inQASection) flushQA();
            if (currentSection) { flushSection(); currentSection = null; }
            pushCurrentQA();

            const qText = trimmed.replace(/^(\d+\.\s*)?Q(uestion|\d+)\s*[\s.:]+/i, '').trim();

            // Check if answer is inline (e.g., "1. Question: text Model Answer: text")
            const inlineSplit = trySplitInline(qText);
            if (inlineSplit) {
                currentQA = { question: inlineSplit.question, answer: inlineSplit.answer, sections: {} };
                inQASection = null;
            } else {
                inQASection = 'question';
                if (qText) contentBuffer.push(qText);
            }
            continue;
        }

        // Check for standalone answer header (e.g., "Answer: text")
        if (QUESTIONS_SECTION_PATTERNS.answer.test(trimmed)) {
            if (inQASection) flushQA();
            if (currentSection) { flushSection(); currentSection = null; }

            inQASection = 'answer';
            const aText = trimmed.replace(/^(Model\s+)?Answer:\s*/i, '').trim();
            if (aText) contentBuffer.push(aText);
            continue;
        }

        // Check for MCQ single-line format (e.g., "1. Question text a) opt Correct Answer: d) expl")
        if (MCQ_LINE_PATTERN.test(trimmed) && !QUESTIONS_SECTION_PATTERNS.question.test(trimmed)) {
            const inlineSplit = trySplitInline(trimmed);
            if (inlineSplit) {
                if (inQASection) flushQA();
                if (currentSection) { flushSection(); currentSection = null; }
                pushCurrentQA();

                const qText = inlineSplit.question.replace(/^\d+[.)]\s*/, '').trim();
                currentQA = { question: qText, answer: inlineSplit.answer, sections: {} };
                inQASection = null;
                continue;
            }
        }

        // Check for other section headers (numbered like "1. MARKING RUBRIC" or plain)
        let foundSection = false;
        for (const [key, pattern] of Object.entries(QUESTIONS_SECTION_PATTERNS)) {
            if (key === 'question' || key === 'answer') continue;
            if (pattern.test(trimmed)) {
                if (inQASection) { flushQA(); inQASection = null; }
                if (currentSection) flushSection();
                currentSection = key;
                foundSection = true;
                break;
            }
        }
        if (foundSection) continue;

        // Content line
        contentBuffer.push(trimmed);
    }

    // Final flush
    if (inQASection) flushQA();
    if (currentSection) flushSection();
    pushCurrentQA();

    return result;
}

export function parseQuestionsCardsHtml(html: string): { qaPairs: Array<{ question: string; answer: string; sections: Array<{ key: string; content: string }> }> } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const result: { qaPairs: Array<{ question: string; answer: string; sections: Array<{ key: string; content: string }> }> } = {
        qaPairs: [],
    };

    const styles = CARD_STYLES.questionsCards;
    const gridEntries = QUESTIONS_CARD_GRID_SECTIONS.map((k) => ({ key: k, title: styles[k].title }));

    let currentQA: { question: string; answer: string; sections: Array<{ key: string; content: string }> } | null = null;

    const children = Array.from(doc.body.children);
    for (const el of children) {
        const h3 = el.querySelector('h3');
        if (!h3) continue;
        const h3Text = (h3.textContent || '').trim();

        if (h3Text.includes('Question')) {
            // New question starts — push previous Q&A if exists
            if (currentQA) result.qaPairs.push(currentQA);
            currentQA = { question: '', answer: '', sections: [] };
            const clone = el.cloneNode(true) as Element;
            clone.querySelector('h3')?.remove();
            // Also remove the wrapper div inserted by convertQuestionsCards for the question text
            const contentDiv = clone.querySelector('div[style*="margin-top"]');
            // Use innerHTML to preserve images and HTML markup
            currentQA.question = (contentDiv ? contentDiv.innerHTML : clone.innerHTML).trim();
        } else if (h3Text.includes('Answer')) {
            if (!currentQA) currentQA = { question: '', answer: '', sections: [] };
            const clone = el.cloneNode(true) as Element;
            clone.querySelector('h3')?.remove();
            const p = clone.querySelector('p');
            currentQA.answer = (p ? p.innerHTML : clone.innerHTML).trim();
        } else if (el.children.length > 1) {
            // Grid cards — attach to current Q&A
            if (!currentQA) currentQA = { question: '', answer: '', sections: [] };
            for (const card of Array.from(el.children)) {
                const cardH3 = card.querySelector('h3');
                if (!cardH3) continue;
                const cardTitle = (cardH3.textContent || '').trim();
                const match = gridEntries.find((e) => cardTitle.includes(e.title));
                const key = match ? match.key : 'rubric';
                const clone = card.cloneNode(true) as Element;
                clone.querySelector('h3')?.remove();
                const p = clone.querySelector('p');
                currentQA.sections.push({ key, content: (p ? p.innerHTML : clone.innerHTML).trim() });
            }
        }
    }

    // Push last Q&A
    if (currentQA) result.qaPairs.push(currentQA);

    // Ensure at least one pair
    if (result.qaPairs.length === 0) {
        result.qaPairs.push({ question: '', answer: '', sections: [] });
    }

    return result;
}

/**
 * Build questions-cards HTML directly from already-parsed HTML content.
 * Unlike convertQuestionsCards (which takes plain text), this preserves
 * HTML markup including images in question/answer/section content.
 */
export function buildQuestionsCardsHtml(
    pairs: Array<{ question: string; answer: string; sections: Array<{ key: string; content: string }> }>
): string {
    const styles = CARD_STYLES.questionsCards;
    let html = '';

    pairs.forEach((qa, idx) => {
        if (qa.question) {
            const c = styles.question;
            const qLabel = pairs.length > 1 ? `Question ${idx + 1}` : 'Question';
            html += `<div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px 20px; border-radius: 12px; margin-bottom: 20px;">
  <h3 style="margin: 0; color: inherit;">${c.emoji} ${qLabel}</h3>
  <div style="margin-top: 8px; color: inherit;">${qa.question}</div>
</div>\n`;
        }

        if (qa.answer) {
            const c = styles.answer;
            html += `<div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px 20px; border-radius: 12px; margin-bottom: 20px;">
  <h3 style="margin-top: 0; color: inherit;">${c.emoji} ${c.title}</h3>
  <p>${qa.answer}</p>
</div>\n`;
        }

        const hasGridCards = qa.sections.some((s) => s.content);
        if (hasGridCards) {
            html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 8px; margin-bottom: 24px;">\n`;
            qa.sections.forEach((s) => {
                if (!s.content) return;
                const c = styles[s.key as keyof typeof styles] as any;
                if (!c) return;
                html += `  <div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px; border-radius: 12px; min-height: 120px;">
    <h3 style="margin-top: 0; color: inherit; font-size: 14px;">${c.emoji} ${c.number}. ${c.title}</h3>
    <p style="margin: 0; font-size: 13px;">${s.content}</p>
  </div>\n`;
            });
            html += '</div>\n';
        }
    });

    return compactHtml(html);
}
