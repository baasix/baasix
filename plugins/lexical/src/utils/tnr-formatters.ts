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
    <p style="margin: 0; font-size: 13px;">${content}</p>
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
    question: /^Q\d+\./i,
    answer: /^Answer:\s*$/i,
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

export function convertQuestionsCards(input: string): string {
    if (!input.trim()) return '';

    const sections = parseQuestionsInput(input);
    const styles = CARD_STYLES.questionsCards;
    let html = '';

    // Question card (full-width)
    if (sections.question) {
        const c = styles.question;
        html += `<div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px 20px; border-radius: 12px; margin-bottom: 20px;">
  <h3 style="margin: 0; color: inherit;">${c.emoji} Question</h3>
  <p style="margin-top: 8px; color: inherit;">${sections.question}</p>
</div>\n`;
    }

    // Answer card (full-width)
    if (sections.answer) {
        const c = styles.answer;
        html += `<div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px 20px; border-radius: 12px; margin-bottom: 20px;">
  <h3 style="margin-top: 0; color: inherit;">${c.emoji} ${c.title}</h3>
  <p>${sections.answer}</p>
</div>\n`;
    }

    // Grid layout for remaining cards
    const hasGridCards = QUESTIONS_CARD_GRID_SECTIONS.some((k) => sections[k]);
    if (hasGridCards) {
        html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 20px;">\n`;
        QUESTIONS_CARD_GRID_SECTIONS.forEach((key) => {
            const content = sections[key];
            if (!content) return;
            const c = styles[key];
            html += `  <div style="background: ${c.light}; border: 2px solid ${c.border}; border-left: 4px solid ${c.border}; padding: 16px; border-radius: 12px; min-height: 120px;">
    <h3 style="margin-top: 0; color: inherit; font-size: 14px;">${c.emoji} ${c.number}. ${c.title}</h3>
    <p style="margin: 0; font-size: 13px;">${content}</p>
  </div>\n`;
        });
        html += '</div>\n';
    }

    return compactHtml(html);
}

function parseQuestionsInput(input: string): Record<string, string> {
    const lines = input.split('\n').filter((l) => l.trim());
    const sections: Record<string, string> = {};
    let currentSection: string | null = null;
    let contentBuffer: string[] = [];

    const flush = () => {
        if (currentSection && contentBuffer.length > 0) {
            sections[currentSection] = contentBuffer.join(' ').trim();
        }
        contentBuffer = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();

        let foundSection = false;
        for (const [key, pattern] of Object.entries(QUESTIONS_SECTION_PATTERNS)) {
            if (pattern.test(trimmed)) {
                flush();
                currentSection = key;
                foundSection = true;
                if (key === 'question') {
                    const qText = trimmed.replace(/^Q\d+\.\s*/, '').trim();
                    if (qText) contentBuffer.push(qText);
                }
                break;
            }
        }
        if (foundSection) continue;

        if (currentSection) {
            contentBuffer.push(trimmed);
        }
    }
    flush();
    return sections;
}

export function parseQuestionsCardsHtml(html: string): { question: string; answer: string; sections: Array<{ key: string; content: string }> } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const result: { question: string; answer: string; sections: Array<{ key: string; content: string }> } = {
        question: '', answer: '', sections: [],
    };

    const styles = CARD_STYLES.questionsCards;
    const gridEntries = QUESTIONS_CARD_GRID_SECTIONS.map((k) => ({ key: k, title: styles[k].title }));

    const children = Array.from(doc.body.children);
    for (const el of children) {
        const h3 = el.querySelector('h3');
        if (!h3) continue;
        const h3Text = (h3.textContent || '').trim();

        if (h3Text.includes('Question')) {
            const clone = el.cloneNode(true) as Element;
            clone.querySelector('h3')?.remove();
            result.question = (clone.textContent || '').trim();
        } else if (h3Text.includes('Answer')) {
            const clone = el.cloneNode(true) as Element;
            clone.querySelector('h3')?.remove();
            result.answer = (clone.textContent || '').trim();
        } else if (el.children.length > 1) {
            for (const card of Array.from(el.children)) {
                const cardH3 = card.querySelector('h3');
                if (!cardH3) continue;
                const cardTitle = (cardH3.textContent || '').trim();
                const match = gridEntries.find((e) => cardTitle.includes(e.title));
                const key = match ? match.key : 'rubric';
                const clone = card.cloneNode(true) as Element;
                clone.querySelector('h3')?.remove();
                result.sections.push({ key, content: (clone.textContent || '').trim() });
            }
        }
    }

    return result;
}
