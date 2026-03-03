"use client";

interface FormField {
  label: string;
  value: string;
  type?: string;
}

interface FormPreviewProps {
  title: string;
  fields: FormField[];
}

export default function FormPreview({ title, fields }: FormPreviewProps) {
  const handleDownload = () => {
    const data = {
      form_title: title,
      fields: fields.reduce(
        (acc, f) => {
          acc[f.label] = f.value;
          return acc;
        },
        {} as Record<string, string>
      ),
      generated_at: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border border-surface-300 rounded-xl p-4 bg-surface-200 mt-3">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-text-900">{title}</h4>
        <button
          onClick={handleDownload}
          className="text-xs bg-sage text-white px-3 py-1 rounded-lg hover:bg-sage-dark transition-colors"
        >
          Download JSON
        </button>
      </div>

      <div className="space-y-3">
        {fields.map((field, i) => (
          <div key={i}>
            <label className="block text-xs text-text-600 mb-1">
              {field.label}
            </label>
            <div className="bg-surface-100 text-text-800 text-sm px-3 py-2 rounded-lg border border-surface-300">
              {field.value || <span className="text-text-500 italic">Empty</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
