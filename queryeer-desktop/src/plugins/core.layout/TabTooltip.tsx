import type { FileEntity } from "../../contracts/files/FileEntity";
import type { TooltipSection, TooltipSectionContribution } from "../../contracts/extensions/TooltipExtension";

export type TabTooltipProps = {
  sections: TooltipSection[];
};

export function TabTooltip({ sections }: TabTooltipProps) {
  return (
    <div className="tab-tooltip">
      {sections.map((section, index) => (
        <div
          key={index}
          className={`tab-tooltip-section ${section.severity ? `severity-${section.severity}` : ""}`}
        >
          <span className="tab-tooltip-label">{section.label}</span>
          <span className="tab-tooltip-value">{section.value}</span>
        </div>
      ))}
    </div>
  );
}

export function buildTabTooltip(
  file: FileEntity,
  contributions: TooltipSectionContribution[]
): TabTooltipProps {
  const sections = contributions
    .filter((c) => c.order >= 0)
    .sort((a, b) => a.order - b.order)
    .map((c) => c.render({ file }))
    .filter((section): section is TooltipSection => section !== null);

  return { sections };
}
