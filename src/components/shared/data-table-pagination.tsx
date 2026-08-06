"use client";

import { type Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const pageSizeItems = PAGE_SIZE_OPTIONS.map((size) => ({
  label: String(size),
  value: String(size),
}));

export function DataTablePagination<TData>({ table }: { table: Table<TData> }) {
  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = table.getCoreRowModel().rows.length;
  const isFiltered = filteredCount !== totalCount;

  // Nothing to page through at all — "0 rows · Page 1 of 1" below an empty
  // state is furniture, not information. A filter that empties a populated
  // table still shows it, because there the count is the answer.
  if (totalCount === 0) return null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-medium">{filteredCount.toLocaleString()}</span>{" "}
        {filteredCount === 1 ? "row" : "rows"}
        {isFiltered && <> of {totalCount.toLocaleString()}</>}
      </p>

      <div className="flex items-center gap-4 lg:gap-6">
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground text-xs font-medium">Rows per page</p>
          <Select
            items={pageSizeItems}
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-muted-foreground text-xs tabular-nums">
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
