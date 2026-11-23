import { MathBlock, MathInline } from "@/components/MathText";

const MATH_TOKEN = /(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g;

export function MarkdownMath({ text }: { text: string }) {
  const parts = String(text ?? "").split(MATH_TOKEN);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
          return <MathBlock key={index} tex={part.slice(2, -2)} className="my-2" />;
        }
        if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
          return <MathInline key={index} tex={part.slice(1, -1)} />;
        }
        return part ? <span key={index}>{part}</span> : null;
      })}
    </>
  );
}
