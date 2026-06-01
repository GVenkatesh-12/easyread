import { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { FileText } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// In-memory cache so we don't re-render covers when the grid re-mounts.
const coverCache = new Map<string, string>();

interface PdfCoverImageProps {
    pdfUrl: string;
    height?: number;
}

export default function PdfCoverImage({ pdfUrl, height = 140 }: PdfCoverImageProps) {
    const [coverSrc, setCoverSrc] = useState<string | null>(() => coverCache.get(pdfUrl) ?? null);
    const [failed, setFailed] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (coverSrc || failed) return;

        let cancelled = false;

        (async () => {
            try {
                const doc = await pdfjsLib.getDocument({
                    url: pdfUrl,
                    disableAutoFetch: true,
                    disableStream: false,
                    rangeChunkSize: 65536,
                }).promise;

                if (cancelled) { doc.destroy(); return; }

                const page = await doc.getPage(1);
                if (cancelled) { doc.destroy(); return; }

                const viewport = page.getViewport({ scale: 1 });
                const targetHeight = height * 2; // 2x for retina
                const scale = targetHeight / viewport.height;
                const scaledViewport = page.getViewport({ scale });

                const canvas = canvasRef.current;
                if (!canvas || cancelled) { doc.destroy(); return; }

                canvas.width = Math.floor(scaledViewport.width);
                canvas.height = Math.floor(scaledViewport.height);

                const ctx = canvas.getContext('2d')!;
                await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

                if (cancelled) { doc.destroy(); return; }

                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                coverCache.set(pdfUrl, dataUrl);
                setCoverSrc(dataUrl);
                doc.destroy();
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();

        return () => { cancelled = true; };
    }, [pdfUrl, height, coverSrc, failed]);

    // Shimmer skeleton while loading
    if (!coverSrc && !failed) {
        return (
            <div
                style={{
                    height: `${height}px`,
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'var(--color-surface-hover)',
                }}
            >
                {/* Shimmer overlay */}
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        background:
                            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 20%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 80%, transparent 100%)',
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 1.5s ease-in-out infinite',
                    }}
                />
                {/* Faint icon hint */}
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: 0.25,
                    }}
                >
                    <FileText size={36} color="var(--color-text-secondary)" />
                </div>
                {/* Hidden canvas for rendering */}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
        );
    }

    // Fallback icon if the cover render failed
    if (failed) {
        return (
            <div
                style={{
                    height: `${height}px`,
                    background: 'var(--color-surface-hover)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <FileText size={40} color="var(--color-text-secondary)" style={{ opacity: 0.5 }} />
            </div>
        );
    }

    // Actual cover image
    return (
        <div
            style={{
                height: `${height}px`,
                overflow: 'hidden',
                position: 'relative',
                background: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'inset 0 0 30px rgba(0,0,0,0.3)',
            }}
        >
            <img
                src={coverSrc!}
                alt="Book cover"
                style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    display: 'block',
                }}
                className="animate-fade-in"
            />
        </div>
    );
}
