"use client";

import type React from "react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "motion/react";
import {
  FileText,
  Upload,
  ArrowLeft,
  Loader2,
  X,
  CheckCircle2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import LimitReachedDialog from "@/components/LimitReachedDialog";
import { UPLOAD_DOCUMENT_LIMIT, WATCHDOC_LIMIT_COPY } from "@/lib/limits";
import { COLORS } from "@/lib/theme";

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [roleFit, setRoleFit] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [manualKeywords, setManualKeywords] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showValidationError, setShowValidationError] = useState(false);
  const [showLimitDialog, setShowLimitDialog] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const openLimitDialog = () => setShowLimitDialog(true);

  const addFiles = (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return;

    const nextFiles = [...files, ...incomingFiles];
    if (nextFiles.length > UPLOAD_DOCUMENT_LIMIT) {
      setFiles(nextFiles.slice(0, UPLOAD_DOCUMENT_LIMIT));
      openLimitDialog();
      return;
    }

    setFiles(nextFiles);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
      [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ].includes(file.type),
    );
    addFiles(droppedFiles);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      addFiles(selectedFiles);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    // Validation check
    const missing: string[] = [];
    if (!roleFit) missing.push("what fits you best");
    if (files.length === 0 && !manualKeywords.trim()) {
      missing.push("resume or keywords");
    }

    if (files.length > UPLOAD_DOCUMENT_LIMIT) {
      openLimitDialog();
      return;
    }

    if (missing.length > 0) {
      setMissingFields(missing);
      setShowValidationError(true);
      return;
    }

    setIsLoading(true);

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("roleFit", roleFit);
    if (location) formData.append("location", location);
    if (manualKeywords.trim()) {
      formData.append("manualKeywords", manualKeywords.trim());
    }

    try {
      const res = await fetch("/api/analyse", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        if (data?.limitReached) {
          openLimitDialog();
          setIsLoading(false);
          return;
        }
        throw new Error(data?.error ?? "Analyze request failed");
      }
      // Redirect to results page with jobId
      router.push(`/results/${data.jobId}`);
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      alert("Failed to start analysis");
    }
  };

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: COLORS.bg, color: COLORS.text }}
    >
      <LimitReachedDialog
        open={showLimitDialog}
        onOpenChange={setShowLimitDialog}
        message={WATCHDOC_LIMIT_COPY}
      />

      {/* Validation Error Dialog */}
      <AlertDialog
        open={showValidationError}
        onOpenChange={setShowValidationError}
      >
        <AlertDialogContent
          className="border"
          style={{
            backgroundColor: COLORS.cardElev,
            borderColor: COLORS.border,
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle
              className="text-base sm:text-lg"
              style={{ color: COLORS.text }}
            >
              Missing Required Fields
            </AlertDialogTitle>
            <AlertDialogDescription style={{ color: COLORS.textMuted }}>
              Please fill in the following required fields before proceeding:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul
            className="list-disc list-inside space-y-2 ml-2"
            style={{ color: COLORS.textMuted }}
          >
            {missingFields.map((field) => (
              <li key={field} className="capitalize text-sm">
                {field}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-3 pt-4">
            <AlertDialogAction
              onClick={() => setShowValidationError(false)}
              style={{
                backgroundColor: COLORS.accent,
                color: COLORS.bg,
              }}
            >
              OK
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Content */}
      <div className="flex-1">
        <div className="max-w-3xl mx-auto px-6 pt-28 pb-14">
          {/* Page header */}
          <div className="mb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-widest mb-4 hover:text-white transition-colors"
              style={{ color: COLORS.textMuted }}
            >
              <ArrowLeft className="w-3 h-3" />
              Back to home
            </Link>
            <h1
              className="text-4xl sm:text-5xl font-bold tracking-tight mb-2"
              style={{ color: COLORS.text }}
            >
              Find Internships
            </h1>
            <p className="text-sm" style={{ color: COLORS.textMuted }}>
              Select what fits you best, upload your resume, or enter keywords
              — we search LinkedIn, Internshala, Wellfound, Naukri, and more.
            </p>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-5"
          >
            {/* Drag and Drop Zone */}
            <motion.div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              animate={{
                borderColor: dragActive ? COLORS.accent : COLORS.border,
                backgroundColor: dragActive ? COLORS.cardElev : COLORS.card,
              }}
              className="relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer"
            >
              <input
                type="file"
                id="file-upload"
                className="hidden"
                multiple={false}
                accept=".pdf,.docx,.txt"
                onChange={handleFileInput}
              />
              <label
                htmlFor="file-upload"
                className="space-y-4 cursor-pointer block"
              >
                <div className="flex justify-center">
                  <motion.div
                    animate={{
                      scale: dragActive ? 1.1 : 1,
                      rotate: dragActive ? 5 : 0,
                    }}
                    className="w-16 h-16 rounded-2xl flex items-center justify-center border"
                    style={{
                      backgroundColor: COLORS.bgElev,
                      borderColor: COLORS.borderStrong,
                    }}
                  >
                    <Upload
                      className="w-7 h-7"
                      style={{ color: COLORS.text }}
                      strokeWidth={1.5}
                    />
                  </motion.div>
                </div>
                <div className="space-y-2">
                  <p
                    className="text-xl font-semibold"
                    style={{ color: COLORS.text }}
                  >
                    {dragActive
                      ? "Release to upload"
                      : "Upload your resume (optional)"}
                  </p>
                  <p className="text-sm" style={{ color: COLORS.textMuted }}>
                    PDF, DOCX, TXT — or skip and use keywords below
                  </p>
                </div>
              </label>
            </motion.div>

            {/* File List */}
            <AnimatePresence>
              {files.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3
                      className="text-xs uppercase tracking-widest font-semibold"
                      style={{ color: COLORS.textMuted }}
                    >
                      {files.length} file{files.length !== 1 ? "s" : ""}{" "}
                      selected
                    </h3>
                    <button
                      onClick={() => setFiles([])}
                      className="text-xs hover:underline"
                      style={{ color: COLORS.textMuted }}
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="space-y-2">
                    {files.map((file, index) => (
                      <motion.div
                        key={`${file.name}-${index}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ delay: index * 0.03 }}
                        className="flex items-center justify-between p-4 rounded-xl border group"
                        style={{
                          backgroundColor: COLORS.card,
                          borderColor: COLORS.border,
                        }}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: COLORS.bgElev }}
                          >
                            <CheckCircle2
                              className="w-4 h-4"
                              style={{ color: COLORS.text }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className="font-medium text-sm truncate"
                              style={{ color: COLORS.text }}
                            >
                              {file.name}
                            </p>
                            <p
                              className="text-xs"
                              style={{ color: COLORS.textMuted }}
                            >
                              {(file.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => removeFile(index)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-lg"
                          style={{ color: COLORS.textMuted }}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Role + keywords */}
            <div
              className="space-y-5 p-6 rounded-2xl border"
              style={{
                backgroundColor: COLORS.card,
                borderColor: COLORS.border,
              }}
            >
              <h3
                className="text-xs uppercase tracking-widest font-semibold"
                style={{ color: COLORS.textMuted }}
              >
                Your profile
              </h3>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium flex items-center gap-1"
                  style={{ color: COLORS.text }}
                >
                  Select what fits you best
                  <span style={{ color: COLORS.text }}>*</span>
                </label>
                <Select value={roleFit} onValueChange={setRoleFit}>
                  <SelectTrigger
                    className="border h-11"
                    style={{
                      backgroundColor: COLORS.bg,
                      borderColor: COLORS.border,
                      color: COLORS.text,
                    }}
                  >
                    <SelectValue placeholder="Choose a track" />
                  </SelectTrigger>
                  <SelectContent
                    style={{
                      backgroundColor: COLORS.cardElev,
                      borderColor: COLORS.border,
                      color: COLORS.text,
                    }}
                  >
                    <SelectItem value="software-engineering">
                      Software Engineering
                    </SelectItem>
                    <SelectItem value="data-ai">Data / AI / ML</SelectItem>
                    <SelectItem value="product">Product / PM</SelectItem>
                    <SelectItem value="design">Design / UX</SelectItem>
                    <SelectItem value="marketing">Marketing / Growth</SelectItem>
                    <SelectItem value="business">Business / Ops</SelectItem>
                    <SelectItem value="other">Other / Exploring</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.text }}
                >
                  Keywords (if no resume)
                </label>
                <textarea
                  value={manualKeywords}
                  onChange={(e) => setManualKeywords(e.target.value)}
                  placeholder="e.g. React, Python, backend, fintech internship"
                  rows={3}
                  className="w-full rounded-xl border px-3 py-2 text-sm resize-none"
                  style={{
                    backgroundColor: COLORS.bg,
                    borderColor: COLORS.border,
                    color: COLORS.text,
                  }}
                />
                <p className="text-xs" style={{ color: COLORS.textMuted }}>
                  Comma-separated skills, tools, or domains. Required when you
                  skip resume upload.
                </p>
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.text }}
                >
                  Preferred location (optional)
                </label>
                <Input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Bangalore, Remote, Mumbai…"
                  className="border h-11"
                  style={{
                    backgroundColor: COLORS.bg,
                    borderColor: COLORS.border,
                    color: COLORS.text,
                  }}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Link href="/" className="flex-1">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full h-12 rounded-xl border font-medium"
                  style={{
                    borderColor: COLORS.borderStrong,
                    color: COLORS.text,
                    backgroundColor: "transparent",
                  }}
                >
                  Cancel
                </motion.button>
              </Link>
              <motion.button
                onClick={handleAnalyze}
                disabled={
                  isLoading || (!files.length && !manualKeywords.trim())
                }
                whileHover={{
                  scale:
                    (files.length > 0 || manualKeywords.trim()) && !isLoading
                      ? 1.02
                      : 1,
                }}
                whileTap={{ scale: 0.98 }}
                className="flex-1 h-12 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: COLORS.accent,
                  color: COLORS.bg,
                }}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Finding internships...
                  </>
                ) : (
                  <>
                    Match Internships
                    <FileText className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
