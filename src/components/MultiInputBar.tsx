import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Send,
  Link as LinkIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Folder,
  X,
  Sparkles,
  Search,
  Globe,
  Loader2,
  Plus,
  Eye,
  Paperclip,
  Zap,
  Cpu,
  Scale,
  Brain,
} from 'lucide-react';
import { InputAttachment, AttachmentType, FolderFileItem, ProcessingTier } from '../types';

interface MultiInputBarProps {
  onSend: (text: string, attachments: InputAttachment[]) => void;
  disabled?: boolean;
  isConnected: boolean;
  onPreviewAttachment?: (attachment: InputAttachment) => void;
  onSearchIntentDetected?: (keywords: string[]) => void;
}

const SEARCH_TRIGGER_KEYWORDS = [
  'search',
  'searching',
  'searched',
  'research',
  'researching',
  'look up',
  'lookup',
  'find',
  'find out',
  'google',
  'browse',
  'latest',
  'recent',
  'news',
  'today',
  'yesterday',
  'current',
  'price',
  'prices',
  'stock',
  'stocks',
  'market',
  'weather',
  'forecast',
  'who is',
  'who won',
  'what is happening',
  'what happened',
  'facts',
  'investigate',
  'sources',
  'citations',
  'references',
  'compare',
  'documentation',
  'release date',
  'review',
  'score',
  'match',
  'schedule',
  'events',
  'trending',
  'headline',
  'stats',
];

const ULTRA_FAST_GREETINGS = [
  'hello', 'hey', 'hi', 'how are you', 'how are you doing', 'how r u',
  'what is up', "what's up", 'good morning', 'good evening', 'good afternoon', 'good day',
  'who are you', 'what is your name', 'what are you', 'tell me a joke', 'say something',
  'thank you', 'thanks', 'cool', 'awesome', 'nice', 'great', 'ok', 'okay', 'yes', 'no',
  'bye', 'goodbye', 'see you', 'sup', 'yo', 'test', 'ping', 'can you hear me', 'howdy'
];

const DIRECT_FAST_KEYWORDS = [
  'function', 'const', 'let', 'var', 'def', 'class', 'import', 'return', 'bug', 'fix', 'debug',
  'error', 'traceback', 'exception', 'stack', 'syntax', 'typescript', 'javascript', 'python', 'rust',
  'sql', 'query', 'database', 'schema', 'api', 'endpoint', 'component', 'regex', 'algorithm',
  'calculate', 'solve', 'equation', 'derivative', 'integral', 'matrix', 'vector', 'proof', 'theorem',
  'physics', 'quantum', 'probability', 'statistics', 'complexity', 'big o', 'puzzle', 'riddle',
  'architecture', 'trade-offs', 'tradeoffs', 'step by step', 'step-by-step', 'in-depth', 'comprehensive',
  'deep dive', 'system design', 'compare and contrast', 'benchmarks', 'performance optimization',
  'research', 'analyze', 'examine', 'audit', 'inspect', 'investigate'
];

export const MultiInputBar: React.FC<MultiInputBarProps> = ({
  onSend,
  disabled = false,
  isConnected,
  onPreviewAttachment,
  onSearchIntentDetected,
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<InputAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [detectedKeywords, setDetectedKeywords] = useState<string[]>([]);

  const menuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  // Compute active auto-detected tier in real time
  const autoTier = useMemo<ProcessingTier>(() => {
    const cleanPrompt = text.trim().toLowerCase();
    const wordCount = cleanPrompt ? cleanPrompt.split(/\s+/).length : 0;
    const hasAttachments = attachments.length > 0;

    if (hasAttachments) {
      const types = attachments.map((a) => a.type).join(', ');
      return {
        id: 'direct_fast',
        name: 'Direct Fast',
        badge: '🧠 Direct Fast',
        description: 'Auto-allocating multimodal reasoning for attached files & structured context.',
        reason: `Multi-input items (${types}) detected`,
        thinkingBudget: 2048,
        color: 'indigo',
      };
    }

    const hasDirectFastKeyword = DIRECT_FAST_KEYWORDS.some((kw) => {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(cleanPrompt);
    });

    const hasCodeChars = cleanPrompt.includes('```') || (/[\{\}\[\]\(\)=\>\<;]/.test(cleanPrompt) && wordCount > 4);

    if (hasDirectFastKeyword || hasCodeChars || wordCount > 70) {
      return {
        id: 'direct_fast',
        name: 'Direct Fast',
        badge: '🧠 Direct Fast',
        description: 'Deep reasoning budget automatically engaged for complex math, code, or in-depth analysis.',
        reason: hasDirectFastKeyword ? 'Code/Math logic query detected' : 'Detailed multi-step query',
        thinkingBudget: 2048,
        color: 'indigo',
      };
    }

    const isGreetingOrBanter = ULTRA_FAST_GREETINGS.some((phrase) => {
      return cleanPrompt === phrase || cleanPrompt.startsWith(phrase + ' ') || cleanPrompt.endsWith(' ' + phrase);
    });

    if (isGreetingOrBanter || (!cleanPrompt || (wordCount <= 7 && !hasDirectFastKeyword))) {
      return {
        id: 'ultra_fast',
        name: 'Ultra Fast',
        badge: '⚡ Ultra Fast',
        description: 'Instant zero-shot conversational speed with low latency voice stream.',
        reason: isGreetingOrBanter ? 'Quick conversational greeting / banter' : 'Short prompt stream',
        thinkingBudget: 0,
        color: 'emerald',
      };
    }

    return {
      id: 'balanced',
      name: 'Balanced',
      badge: '⚖️ Balanced',
      description: 'Balanced thinking synthesis for articulate explanations and natural speech flow.',
      reason: 'General knowledge / explanation query',
      thinkingBudget: 512,
      color: 'amber',
    };
  }, [text, attachments]);

  // Detect search/research keywords in real-time as user types or adds attachments
  useEffect(() => {
    const lower = text.toLowerCase();
    const hasUrl = /https?:\/\/[^\s]+/.test(text) || attachments.some((a) => a.type === 'link');

    const matched = SEARCH_TRIGGER_KEYWORDS.filter((kw) => {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(lower);
    });

    if (hasUrl && !matched.includes('link')) {
      matched.push('web link');
    }

    setDetectedKeywords(matched);
    if (matched.length > 0 && onSearchIntentDetected) {
      onSearchIntentDetected(matched);
    }
  }, [text, attachments, onSearchIntentDetected]);

  // Handle Form Submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!text.trim() && attachments.length === 0) || disabled) return;
    onSend(text.trim(), attachments);
    setText('');
    setAttachments([]);
    setIsMenuOpen(false);
  };

  // Convert File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Read File as Text
  const fileToText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Handle Image Selection
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: InputAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64 = await fileToBase64(file);
      newAttachments.push({
        id: `img-${Date.now()}-${i}`,
        type: 'image',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'image/jpeg',
        data: base64,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  // Handle Video Selection
  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: InputAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64 = await fileToBase64(file);
      newAttachments.push({
        id: `vid-${Date.now()}-${i}`,
        type: 'video',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'video/mp4',
        data: base64,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  // Handle Document/File Selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: InputAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isPdf = file.type === 'application/pdf';
      const isText =
        file.type.startsWith('text/') ||
        file.name.endsWith('.ts') ||
        file.name.endsWith('.tsx') ||
        file.name.endsWith('.js') ||
        file.name.endsWith('.jsx') ||
        file.name.endsWith('.py') ||
        file.name.endsWith('.json') ||
        file.name.endsWith('.md') ||
        file.name.endsWith('.csv') ||
        file.name.endsWith('.html') ||
        file.name.endsWith('.css');

      let data = '';
      if (isPdf) {
        data = await fileToBase64(file);
      } else if (isText) {
        data = await fileToText(file);
      } else {
        data = await fileToBase64(file);
      }

      newAttachments.push({
        id: `doc-${Date.now()}-${i}`,
        type: isText ? 'code' : 'document',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        data,
      });
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle Folder Selection (Directory Upload)
  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const folderFiles: FolderFileItem[] = [];
    let totalSize = 0;
    let folderName = 'Uploaded Folder';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      totalSize += file.size;

      // Extract relative directory path
      const relativePath = (file as any).webkitRelativePath || file.name;
      if (i === 0 && (file as any).webkitRelativePath) {
        folderName = (file as any).webkitRelativePath.split('/')[0] || 'Uploaded Folder';
      }

      const isText =
        file.size < 100000 &&
        (file.type.startsWith('text/') ||
          /\.(ts|tsx|js|jsx|py|json|md|csv|html|css|txt|env|yaml|yml|xml|sql)$/i.test(file.name));

      let content = '';
      if (isText) {
        try {
          content = await fileToText(file);
        } catch (err) {
          // ignore unreadable
        }
      }

      folderFiles.push({
        path: relativePath,
        name: file.name,
        size: file.size,
        type: file.type || 'file',
        content,
      });
    }

    const folderAttachment: InputAttachment = {
      id: `fld-${Date.now()}`,
      type: 'folder',
      name: folderName,
      folderName,
      size: totalSize,
      fileCount: files.length,
      mimeType: 'application/x-directory',
      folderFiles,
    };

    setAttachments((prev) => [...prev, folderAttachment]);
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  // Remove Attachment
  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Drag & Drop Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const newAttachments: InputAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        newAttachments.push({
          id: `img-${Date.now()}-${i}`,
          type: 'image',
          name: file.name,
          size: file.size,
          mimeType: file.type,
          data: base64,
          previewUrl: URL.createObjectURL(file),
        });
      } else if (file.type.startsWith('video/')) {
        const base64 = await fileToBase64(file);
        newAttachments.push({
          id: `vid-${Date.now()}-${i}`,
          type: 'video',
          name: file.name,
          size: file.size,
          mimeType: file.type,
          data: base64,
          previewUrl: URL.createObjectURL(file),
        });
      } else {
        const isPdf = file.type === 'application/pdf';
        const isText = file.type.startsWith('text/') || /\.(ts|tsx|js|py|json|md|csv)$/i.test(file.name);
        const data = isText ? await fileToText(file) : await fileToBase64(file);
        newAttachments.push({
          id: `doc-${Date.now()}-${i}`,
          type: isText ? 'code' : 'document',
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          data,
        });
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  return (
    <div
      id="multi-input-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`w-full transition-all relative ${
        isDragging ? 'ring-1 ring-cyan-500 rounded-2xl bg-cyan-950/20' : ''
      }`}
    >
      {/* Hidden File Pickers */}
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleImageChange}
        accept="image/*"
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={videoInputRef}
        onChange={handleVideoChange}
        accept="video/*"
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="*/*"
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderChange}
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
        className="hidden"
      />

      {/* Auto-Search / Grounding notification */}
      {detectedKeywords.length > 0 && (
        <div
          id="auto-search-active-pill"
          className="mb-2 px-3 py-1 text-xs text-cyan-400 flex items-center gap-2 animate-fadeIn"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[11px] font-mono">
            Grounding: {detectedKeywords.slice(0, 3).map((k) => `"${k}"`).join(', ')}
          </span>
        </div>
      )}

      {/* Attachments Tray */}
      {attachments.length > 0 && (
        <div
          id="active-attachments-tray"
          className="mb-2.5 flex items-center gap-2 overflow-x-auto py-1"
        >
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900/90 text-xs text-slate-200 flex-shrink-0 group"
            >
              {/* Type Preview/Icon */}
              {att.type === 'image' && att.previewUrl ? (
                <img
                  src={att.previewUrl}
                  alt={att.name}
                  className="w-4 h-4 rounded-full object-cover"
                />
              ) : att.type === 'video' ? (
                <VideoIcon className="w-3.5 h-3.5 text-purple-400" />
              ) : att.type === 'folder' ? (
                <Folder className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-sky-400" />
              )}

              {/* Title / Name */}
              <button
                type="button"
                onClick={() => onPreviewAttachment && onPreviewAttachment(att)}
                className="max-w-[130px] truncate text-left text-xs font-mono hover:text-cyan-300 transition-colors"
                title={`Click to preview ${att.name}`}
              >
                {att.name}
                {att.fileCount ? ` (${att.fileCount})` : ''}
              </button>

              {/* Remove Button */}
              <button
                type="button"
                onClick={() => handleRemoveAttachment(att.id)}
                className="text-slate-400 hover:text-rose-400 p-0.5 rounded-full transition-colors"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setAttachments([])}
            className="text-[11px] text-slate-500 hover:text-rose-400 px-2 py-0.5 transition-colors flex-shrink-0 font-mono"
          >
            Clear
          </button>
        </div>
      )}

      {/* Main Plain Floating Input Form */}
      <form onSubmit={handleSubmit} className="w-full">
        <div className="flex items-center gap-2 p-1.5 rounded-full bg-slate-900/80 backdrop-blur-md relative shadow-lg">
          {/* Plain + Button & Floating Popover */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              id="open-attachments-menu-btn"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              disabled={disabled}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                isMenuOpen
                  ? 'bg-cyan-500 text-white'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white'
              } disabled:opacity-40`}
              title="Attach media or files"
            >
              <Plus
                className={`w-4 h-4 transition-transform duration-200 ${
                  isMenuOpen ? 'rotate-45' : ''
                }`}
              />
            </button>

            {/* Plain Clean Popover Menu */}
            {isMenuOpen && (
              <div
                id="attachments-popover-menu"
                className="absolute bottom-full left-0 mb-3 w-52 bg-slate-900/95 backdrop-blur-xl rounded-2xl p-1.5 z-50 animate-fadeIn shadow-2xl"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      imageInputRef.current?.click();
                      setIsMenuOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-slate-800/70 transition-all text-xs font-mono text-slate-200 hover:text-white"
                  >
                    <ImageIcon className="w-4 h-4 text-emerald-400" />
                    <span>Images</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      videoInputRef.current?.click();
                      setIsMenuOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-slate-800/70 transition-all text-xs font-mono text-slate-200 hover:text-white"
                  >
                    <VideoIcon className="w-4 h-4 text-purple-400" />
                    <span>Videos</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setIsMenuOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-slate-800/70 transition-all text-xs font-mono text-slate-200 hover:text-white"
                  >
                    <FileText className="w-4 h-4 text-sky-400" />
                    <span>Files & Code</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      folderInputRef.current?.click();
                      setIsMenuOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-slate-800/70 transition-all text-xs font-mono text-slate-200 hover:text-white"
                  >
                    <Folder className="w-4 h-4 text-amber-400" />
                    <span>Folder Directory</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Prompt Text Input */}
          <input
            type="text"
            id="multi-verbal-input-field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={disabled}
            placeholder={
              attachments.length > 0
                ? `Analyze ${attachments.length} attached items...`
                : 'Ask F.R.I.D.A.Y. anything...'
            }
            className="flex-1 px-3 py-1.5 text-xs sm:text-sm bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-50"
          />

          {/* Plain Send Button */}
          <button
            type="submit"
            id="send-multi-input-btn"
            disabled={(!text.trim() && attachments.length === 0) || disabled}
            className="w-9 h-9 rounded-full bg-cyan-500 hover:bg-cyan-400 text-white flex items-center justify-center transition-all disabled:opacity-20 disabled:pointer-events-none flex-shrink-0"
            title="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};
