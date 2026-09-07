import { Text as FluentText } from "@fluentui/react-components";

interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 p-3">
      <FluentText
        size={300}
        wrap
        className="text-description text-center"
        style={{ lineHeight: 1.4 }}
      >
        {message}
      </FluentText>
    </div>
  );
}
