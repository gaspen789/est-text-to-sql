import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface TableSkeletonProps {
  columns?: number;
  rows?: number;
  showHeader?: boolean;
}

export function TableSkeleton({ columns = 5, rows = 5, showHeader = true }: TableSkeletonProps) {
  return (
    <Table>
      {showHeader && (
        <TableHeader>
          <TableRow>
            {Array.from({ length: columns }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-24" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <TableRow key={rowIndex}>
            {Array.from({ length: columns }).map((_, colIndex) => (
              <TableCell key={colIndex}>
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface CardSkeletonProps {
  lines?: number;
}

export function CardSkeleton({ lines = 4 }: CardSkeletonProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <Skeleton className="h-6 w-32" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface DetailSkeletonProps {
  sections?: number;
}

export function DetailSkeleton({ sections = 3 }: DetailSkeletonProps) {
  return (
    <div className="space-y-6">
      {Array.from({ length: sections }).map((_, i) => (
        <CardSkeleton key={i} lines={4} />
      ))}
    </div>
  );
}

export function ListSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
