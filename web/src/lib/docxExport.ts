import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { Resume } from "./schema";

const ACCENT_COLOR = "111111";
const MUTED_COLOR = "444444";
const BORDER_COLOR = "222222";

export async function generateDocxBlob(resume: Resume): Promise<Blob> {
  const b = resume.basics;
  const hidden = new Set(resume.layout.hidden);
  const children: (Paragraph | Table)[] = [];

  // 1. Header: Name
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60 },
      children: [
        new TextRun({
          text: b.name || "Resume",
          bold: true,
          size: 36, // 18pt
          font: "Arial",
          color: ACCENT_COLOR,
        }),
      ],
    })
  );

  // Contact line
  const contactText =
    b.contact_line ||
    [b.email, b.phone, b.location, ...(b.links || [])].filter(Boolean).join("  |  ");

  if (contactText) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 60 },
        children: [
          new TextRun({
            text: contactText,
            size: 16, // 8pt
            font: "Arial",
            color: MUTED_COLOR,
          }),
        ],
      })
    );
  }

  // Sub-badge / headline
  const badgeText = b.sub_badge || b.headline;
  if (badgeText) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 140 },
        children: [
          new TextRun({
            text: badgeText,
            bold: true,
            size: 18, // 9pt
            font: "Arial",
            color: ACCENT_COLOR,
          }),
        ],
      })
    );
  }

  // Helper for Section Titles with bottom border
  const makeSectionHeader = (title: string) => {
    return new Paragraph({
      spacing: { before: 180, after: 80 },
      border: {
        bottom: {
          color: BORDER_COLOR,
          space: 2,
          style: BorderStyle.SINGLE,
          size: 10,
        },
      },
      children: [
        new TextRun({
          text: title.toUpperCase(),
          bold: true,
          size: 20, // 10pt
          font: "Arial",
          color: ACCENT_COLOR,
        }),
      ],
    });
  };

  // Helper for two-column header row (Left: Title/Company, Right: Dates)
  const makeEntryHeader = (leftBold: string, leftSub: string, rightDates: string) => {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 75, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
              },
              children: [
                new Paragraph({
                  spacing: { before: 60, after: 20 },
                  children: [
                    new TextRun({ text: leftBold, bold: true, size: 19, font: "Arial", color: ACCENT_COLOR }),
                    leftSub ? new TextRun({ text: `  ·  ${leftSub}`, size: 18, font: "Arial", color: MUTED_COLOR }) : new TextRun(""),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 25, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
              },
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { before: 60, after: 20 },
                  children: [
                    new TextRun({ text: rightDates, size: 17, font: "Arial", color: MUTED_COLOR }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
  };

  // Helper for bullets
  const makeBullet = (bulletText: string) => {
    return new Paragraph({
      bullet: { level: 0 },
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 20, after: 40 },
      children: [
        new TextRun({
          text: bulletText,
          size: 18, // 9pt
          font: "Arial",
          color: "1a1a1a",
        }),
      ],
    });
  };

  for (const secKey of resume.layout.order) {
    if (hidden.has(secKey)) continue;

    if (secKey === "summary" && resume.summary) {
      children.push(makeSectionHeader("Professional Summary"));
      children.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { before: 40, after: 100 },
          children: [
            new TextRun({
              text: resume.summary,
              size: 18, // 9pt
              font: "Arial",
              color: "1a1a1a",
            }),
          ],
        })
      );
    } else if (secKey === "skills" && resume.skills.length > 0) {
      const activeSkills = resume.skills.filter((g) => !hidden.has(g.id));
      if (activeSkills.length > 0) {
        children.push(makeSectionHeader("Technical Skills"));
        for (const g of activeSkills) {
          children.push(
            new Paragraph({
              spacing: { before: 20, after: 40 },
              children: [
                new TextRun({ text: `${g.category}: `, bold: true, size: 18, font: "Arial", color: ACCENT_COLOR }),
                new TextRun({ text: g.items.join(", "), size: 18, font: "Arial", color: "1a1a1a" }),
              ],
            })
          );
        }
      }
    } else if (secKey === "experience" && resume.experience.length > 0) {
      const activeExp = resume.experience.filter((e) => !hidden.has(e.id));
      if (activeExp.length > 0) {
        children.push(makeSectionHeader("Professional Experience"));
        for (const exp of activeExp) {
          children.push(makeEntryHeader(exp.company, exp.role, exp.dates));
          if (exp.location) {
            children.push(
              new Paragraph({
                spacing: { before: 0, after: 30 },
                children: [new TextRun({ text: exp.location, italics: true, size: 16, font: "Arial", color: MUTED_COLOR })],
              })
            );
          }
          for (const b of exp.bullets) {
            if (b.trim()) children.push(makeBullet(b.trim()));
          }
        }
      }
    } else if (secKey === "projects" && resume.projects.length > 0) {
      const activeProj = resume.projects.filter((p) => !hidden.has(p.id));
      if (activeProj.length > 0) {
        children.push(makeSectionHeader("Projects"));
        for (const proj of activeProj) {
          children.push(makeEntryHeader(proj.name, proj.link || "", proj.dates));
          if (proj.stack && proj.stack.length > 0) {
            children.push(
              new Paragraph({
                spacing: { before: 0, after: 30 },
                children: [
                  new TextRun({ text: "Tech Stack: ", bold: true, size: 16, font: "Arial", color: MUTED_COLOR }),
                  new TextRun({ text: proj.stack.join(", "), size: 16, font: "Arial", color: MUTED_COLOR }),
                ],
              })
            );
          }
          for (const b of proj.bullets) {
            if (b.trim()) children.push(makeBullet(b.trim()));
          }
        }
      }
    } else if (secKey === "custom" && resume.custom_sections.length > 0) {
      for (const cs of resume.custom_sections) {
        if (hidden.has(cs.id)) continue;
        const activeItems = cs.items.filter((it) => !hidden.has(it.id));
        if (activeItems.length === 0) continue;
        children.push(makeSectionHeader(cs.title || "Custom Section"));
        for (const it of activeItems) {
          children.push(makeEntryHeader(it.title, it.subtitle, it.dates));
          for (const b of it.bullets) {
            if (b.trim()) children.push(makeBullet(b.trim()));
          }
        }
      }
    } else if (secKey === "certifications" && resume.certifications.length > 0) {
      children.push(makeSectionHeader("Certifications"));
      children.push(
        new Paragraph({
          spacing: { before: 40, after: 80 },
          children: [
            new TextRun({
              text: resume.certifications.join("  •  "),
              size: 18,
              font: "Arial",
              color: "1a1a1a",
            }),
          ],
        })
      );
    } else if (secKey === "education" && resume.education.length > 0) {
      const activeEdu = resume.education.filter((e) => !hidden.has(e.id));
      if (activeEdu.length > 0) {
        children.push(makeSectionHeader("Education"));
        for (const edu of activeEdu) {
          children.push(makeEntryHeader(edu.degree, edu.institution, edu.dates));
          if (edu.details) {
            children.push(
              new Paragraph({
                spacing: { before: 0, after: 30 },
                children: [new TextRun({ text: edu.details, size: 16, font: "Arial", color: MUTED_COLOR })],
              })
            );
          }
        }
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 567, // 10mm
              bottom: 567,
              left: 850, // 15mm
              right: 850,
            },
          },
        },
        children,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

export function downloadDocxBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
