"use client";

import { type Table } from "@tanstack/react-table";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import type { DataTableFilterableColumn } from "./data-table";

export function DataTableToolbar<TData>({
  table,
  searchPlaceholder,
  filterableColumns = [],
  children,
}: {
  table: Table<TData>;
  searchPlaceholder?: string;
  filterableColumns?: DataTableFilterableColumn[];
  children?: React.ReactNode;
}) {
  const globalFilter = (table.getState().globalFilter as string) ?? "";
  const isFiltered = table.getState().columnFilters.length > 0 || globalFilter.length > 0;

  // A toolbar with nothing in it is a 12px gap above the table, not a toolbar.
  if (!searchPlaceholder && filterableColumns.length === 0 && !children) return null;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {searchPlaceholder ? (
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
            <Input
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(event) => table.setGlobalFilter(event.target.value)}
              className="h-8 w-[200px] pl-8 lg:w-[280px]"
            />
          </div>
        ) : null}

        {filterableColumns.map((column) =>
          table.getColumn(column.id) ? (
            <DataTableFacetedFilter
              key={column.id}
              column={table.getColumn(column.id)}
              title={column.title}
              options={column.options}
            />
          ) : null
        )}

        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              table.resetColumnFilters();
              table.setGlobalFilter("");
            }}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
