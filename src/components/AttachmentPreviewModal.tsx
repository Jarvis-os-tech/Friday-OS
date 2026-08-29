import React from 'react';
import { X, FileText, Folder, Link as LinkIcon, Image as ImageIcon, Video as VideoIcon, ExternalLink, Download } from 'lucide-react';
import { InputAttachment } from '../types';

interface AttachmentPreviewModalProps {
  attachment: InputAttachment | null;
  onClose: () => void;
}

export const AttachmentPreviewModal: React.FC<AttachmentPreviewModalProps> = ({
  attachment,
  onClose,
}) => {
  if (!attachment) return null;

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div
      id="attachment-preview-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="attachment-preview-modal-content"
        className="w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-950/70 border border-indigo-700/40 text-indigo-400">
              {attachment.type === 'image' && <ImageIcon className="w-5 h-5" />}
              {attachment.type === 'video' && <VideoIcon className="w-5 h-5" />}
              {attachment.type === 'folder' && <Folder className="w-5 h-5" />}
              {attachment.type === 'link' && <LinkIcon className="w-5 h-5" />}
              {(attachment.type === 'document' || attachment.type === 'code') && <FileText className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-100 truncate">
                {attachment.name}
              </h3>
              <p className="text-xs text-slate-400">
                {attachment.type.toUpperCase()} • {formatFileSize(attachment.size)} {attachment.mimeType ? `• ${attachment.mimeType}` : ''}
              </p>
            </div>
          </div>

          <button
            id="close-attachment-modal-btn"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Image Preview */}
          {attachment.type === 'image' && (
            <div className="flex flex-col items-center justify-center bg-slate-950/60 rounded-xl p-3 border border-slate-800">
              <img
                src={attachment.previewUrl || attachment.data}
                alt={attachment.name}
                className="max-h-[50vh] w-auto max-w-full rounded-lg object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          {/* Video Preview */}
          {attachment.type === 'video' && (
            <div className="flex flex-col items-center justify-center bg-slate-950/60 rounded-xl p-3 border border-slate-800">
              <video
                src={attachment.previewUrl || attachment.data}
                controls
                className="max-h-[50vh] w-full rounded-lg object-contain bg-black"
              />
            </div>
          )}

          {/* Link Preview */}
          {attachment.type === 'link' && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-300">
                    {attachment.linkMetadata?.domain || 'Web URL'}
                  </span>
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-400 hover:text-indigo-200 flex items-center gap-1"
                  >
                    <span>Open Webpage</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <h4 className="text-sm font-medium text-slate-100">
                  {attachment.linkMetadata?.title || attachment.url}
                </h4>
                {attachment.linkMetadata?.description && (
                  <p className="text-xs text-slate-300">
                    {attachment.linkMetadata.description}
                  </p>
                )}
              </div>

              {attachment.data && (
                <div>
                  <h5 className="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Extracted Text Context:
                  </h5>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 max-h-60 overflow-y-auto text-xs text-slate-300 font-mono whitespace-pre-wrap">
                    {attachment.data}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Folder Preview */}
          {attachment.type === 'folder' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">
                  Total Files: <strong className="text-indigo-400">{attachment.fileCount || attachment.folderFiles?.length || 0}</strong>
                </span>
                <span className="text-xs text-slate-400">
                  Total Size: {formatFileSize(attachment.size)}
                </span>
              </div>

              <div>
                <h5 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                  Included Folder Files & Hierarchy:
                </h5>
                <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/60 max-h-64 overflow-y-auto">
                  {attachment.folderFiles?.map((file, i) => (
                    <div key={i} className="p-2.5 flex items-center justify-between text-xs hover:bg-slate-900/80">
                      <div className="flex items-center gap-2 truncate pr-2">
                        <FileText className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                        <span className="font-mono text-slate-200 truncate">{file.path}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 flex-shrink-0">
                        {formatFileSize(file.size)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Document / Code File Preview */}
          {(attachment.type === 'document' || attachment.type === 'code') && (
            <div>
              <h5 className="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                File Content Preview:
              </h5>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 max-h-72 overflow-y-auto text-xs text-slate-200 font-mono whitespace-pre-wrap">
                {attachment.data || 'No preview available for binary file.'}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
