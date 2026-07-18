"use client";

import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Rows come from the server; the caller owns any server page state.
export type ServerPagination = {
  pageIndex: number;
  pageCount: number;
  onPageChange: (pageIndex: number) => void;
};

// The table convention for every CRUD list: compose DataTable with a per-domain
// columns file — never build bespoke tables. Client-side pagination/filtering
// suffices for reference data; pass `serverPagination` for large datasets.
export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder,
  emptyMessage = "No records found.",
  pageSize = 10,
  serverPagination,
}: {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  pageSize?: number;
  serverPagination?: ServerPagination;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      ...(serverPagination
        ? { pagination: { pageIndex: serverPagination.pageIndex, pageSize } }
        : {}),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(serverPagination
      ? { manualPagination: true, pageCount: serverPagination.pageCount }
      : { getPaginationRowModel: getPaginationRowModel() }),
    initialState: { pagination: { pageSize } },
  });

  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  function goToPage(index: number) {
    if (serverPagination) serverPagination.onPageChange(index);
    else table.setPageIndex(index);
  }

  return (
    <div className="flex flex-col gap-3">
      {searchPlaceholder ? (
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
        </InputGroup>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground h-24 text-center"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-xs">
            Page {pageIndex + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goToPage(pageIndex - 1)}
            disabled={pageIndex <= 0}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goToPage(pageIndex + 1)}
            disabled={pageIndex >= pageCount - 1}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
