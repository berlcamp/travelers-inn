"use client";

import { type Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Sortable header cell. Keeps the small uppercase look of the plain headers so
 * sortable and non-sortable columns sit on the same baseline.
 */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
}) {
  if (!column.getCanSort()) {
    return (
      <div
        className={cn(
          "text-muted-foreground text-xs font-semibold tracking-wider uppercase",
          className
        )}
      >
        {title}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground data-[popup-open]:bg-accent -ml-2 h-7 px-2 text-xs font-semibold tracking-wider uppercase"
            />
          }
        >
          <span>{title}</span>
          {column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-1.5 h-3.5 w-3.5" />
          ) : column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-1.5 h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 opacity-50" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
            <ArrowUp className="text-muted-foreground/70 mr-2 h-3.5 w-3.5" />
            Asc
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
            <ArrowDown className="text-muted-foreground/70 mr-2 h-3.5 w-3.5" />
            Desc
          </DropdownMenuItem>
          {column.getCanHide() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
                <EyeOff className="text-muted-foreground/70 mr-2 h-3.5 w-3.5" />
                Hide
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
