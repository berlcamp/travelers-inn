"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type Table as ReactTableInstance,
  type VisibilityState,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";
import type { FacetedFilterOption } from "./data-table-faceted-filter";

export interface DataTableFilterableColumn {
  id: string;
  title: string;
  options: FacetedFilterOption[];
}

/**
 * Faceted filters are multi-select, so every filterable column needs a filter
 * function that treats the filter value as a **set**. TanStack's default is
 * equality against a single value, which silently matches nothing the moment a
 * second option is ticked.
 */
export const includesValue = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: string[]
) => value.includes(String(row.getValue(id)));

// The table convention for every CRUD list: compose DataTable with a per-domain
// columns file — never build bespoke tables. Every row is held in memory, so
// filtering, sorting and paging happen without a server round trip; that suits
// the inn's fixed-size lists (rooms, staff, a season of bookings).
export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder,
  filterableColumns = [],
  toolbar,
  emptyMessage = "No records found.",
  emptyState,
  initialSorting = [],
  initialColumnVisibility,
  pageSize = 25,
}: {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Renders the global-search box. Omit for a table with nothing to search. */
  searchPlaceholder?: string;
  /** Faceted (multi-select) filter chips, one per column id. */
  filterableColumns?: DataTableFilterableColumn[];
  /** Buttons that sit at the right end of the toolbar row. */
  toolbar?: React.ReactNode | ((table: ReactTableInstance<TData>) => React.ReactNode);
  emptyMessage?: string;
  emptyState?: React.ReactNode;
  initialSorting?: SortingState;
  initialColumnVisibility?: VisibilityState;
  pageSize?: number;
}) {
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initialColumnVisibility ?? {}
  );
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");

  // The table instance hands back functions the React Compiler can't safely
  // memoize. That's inherent to TanStack Table, not something to fix here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, columnFilters, globalFilter },
    initialState: { pagination: { pageSize } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    autoResetPageIndex: true,
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        searchPlaceholder={searchPlaceholder}
        filterableColumns={filterableColumns}
      >
        {typeof toolbar === "function" ? toolbar(table) : toolbar}
      </DataTableToolbar>

      <div className="border-border/60 bg-card overflow-hidden rounded-xl border shadow-sm">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="border-border/60 bg-muted/40 hover:bg-muted/40 border-b"
              >
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className="text-muted-foreground h-9 px-3 text-xs font-semibold tracking-wider uppercase"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  // Visible, not all — a hidden filter-only column has no
                  // <th>, so counting it over-spans the empty-state row.
                  colSpan={table.getVisibleLeafColumns().length}
                  className="text-muted-foreground py-16 text-center"
                >
                  {emptyState ?? <p className="text-sm font-medium">{emptyMessage}</p>}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="border-border/40 hover:bg-muted/30">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-3 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} />
    </div>
  );
}
