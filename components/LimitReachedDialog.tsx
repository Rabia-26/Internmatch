"use client";

import { Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { COLORS } from "@/lib/theme";

type LimitReachedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  message: string;
};

export default function LimitReachedDialog({
  open,
  onOpenChange,
  title = "InternMatch limit reached",
  message,
}: LimitReachedDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="border max-w-xl"
        style={{
          backgroundColor: COLORS.cardElev,
          borderColor: COLORS.borderStrong,
        }}
      >
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: `${COLORS.accent}18` }}
            >
              <Sparkles className="w-5 h-5" style={{ color: COLORS.accent }} />
            </div>
            <AlertDialogTitle style={{ color: COLORS.text }}>
              {title}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription
            className="whitespace-pre-line leading-relaxed"
            style={{ color: COLORS.textMuted }}
          >
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-start">
          <AlertDialogAction
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center justify-center rounded-md px-4 py-2"
            style={{ backgroundColor: COLORS.accent, color: COLORS.bg }}
          >
            OK
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
