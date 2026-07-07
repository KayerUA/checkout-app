import * as React from "react";

import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full text-left text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b text-xs uppercase tracking-wide text-muted-foreground", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("align-top transition-colors hover:bg-secondary/40", className)} {...props} />;
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("px-4 py-3 font-medium", className)} {...props} />;
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3", className)} {...props} />;
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
