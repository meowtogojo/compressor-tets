
const ACCESS_PASSWORD = "1234noobie";
const MAX_VIDEO_SIZE = 5 * 1024 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 32_000_000;
const MEDIABUNNY_URL = "https://cdn.jsdelivr.net/npm/mediabunny@1.30.0/+esm";

let tools = null;
let enginePromise = null;
let activeJob = false;
let selectedVideo = null;
let selectedImage = null;
let selectedDocument = null;
let videoPreviewURL = null;
let imagePreviewURL = null;
let startedAt = 0;

const allowedVideoExtensions = [
    "mp4", "m4v", "mov", "mkv", "webm", "avi",
    "flv", "wmv", "mpg", "mpeg", "3gp", "ts",
    "mts", "m2ts", "ogv", "ogg", "mxf"
];

function $(id) {
    return document.getElementById(id);
}

function log(message, type = "info") {
    const output = $("consoleOutput");
    if (!output) return;

    const entry = document.createElement("div");
    entry.className = `console-entry console-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

    output.appendChild(entry);
    output.scrollTop = output.scrollHeight;
}

function setStatus(element, message, type = "") {
    if (!element) return;

    element.textContent = message;
    element.classList.remove("error", "success", "hidden");

    if (!message) {
        element.classList.add("hidden");
        return;
    }

    if (type) element.classList.add(type);
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );

    return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--";

    if (seconds < 60) return `${Math.ceil(seconds)} seconds`;

    return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
}

function formatVideoPosition(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    const hours = Math.floor(minutes / 60);
    const displayMinutes = minutes % 60;
    const clock = `${String(displayMinutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;

    return hours ? `${hours}:${clock}` : clock;
}

function getExtension(filename) {
    return filename.split(".").pop().toLowerCase();
}

function safeFilename(filename, extension) {
    const base = filename.replace(/\.[^/.]+$/, "");
    const clean = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

    return `${clean}-compressed.${extension}`;
}

function loadEngine() {
    if (!enginePromise) {
        enginePromise = import(MEDIABUNNY_URL)
            .then(module => {
                tools = module;

                const required = [
                    "Input",
                    "BlobSource",
                    "ALL_FORMATS",
                    "Output",
                    "Mp4OutputFormat",
                    "BufferTarget",
                    "Conversion"
                ];

                for (const name of required) {
                    if (!tools[name]) {
                        throw new Error(`Media engine is missing ${name}.`);
                    }
                }

                log("Media engine loaded.", "success");
                return tools;
            })
            .catch(error => {
                enginePromise = null;
                throw error;
            });
    }

    return enginePromise;
}

function setProgress(percent, message, hint = "") {
    const value = Math.max(0, Math.min(100, percent));

    if ($("videoPercent")) {
        $("videoPercent").textContent = `${Math.round(value)}%`;
    }

    if ($("videoBar")) {
        $("videoBar").style.width = `${value}%`;
    }

    if ($("videoProgressText")) {
        $("videoProgressText").textContent = message;
    }

    if ($("videoProgressHint")) {
        $("videoProgressHint").textContent = hint;
    }
}

function showVideoProgress(show) {
    $("videoProgress")?.classList.toggle("hidden", !show);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function showVideoResult(filename, originalSize, outputSize, blob) {
    const result = $("videoResult");
    if (!result) return;

    result.innerHTML = "";

    const heading = document.createElement("h3");
    heading.textContent = "Compression complete";

    const stats = document.createElement("div");
    stats.className = "stats";

    const change = originalSize > 0
        ? ((outputSize - originalSize) / originalSize) * 100
        : 0;
    const changeLabel = change <= 0
        ? `${Math.abs(change).toFixed(1)}% smaller`
        : `${change.toFixed(1)}% larger`;

    [
        ["Before", formatBytes(originalSize)],
        ["After", formatBytes(outputSize)],
        ["Size change", changeLabel]
    ].forEach(([label, value]) => {
        const stat = document.createElement("div");
        stat.className = "stat";

        const name = document.createElement("span");
        name.textContent = label;

        const amount = document.createElement("strong");
        amount.textContent = value;

        stat.append(name, amount);
        stats.append(stat);
    });

    const download = document.createElement("button");
    download.textContent = "Download compressed video";
    download.className = "download-link";

    download.addEventListener("click", () => {
        downloadBlob(blob, filename);
        log("Video download started.", "success");
    });

    result.append(heading, stats, download);
    result.classList.remove("hidden");
}

function showImageResult(file, filename, blob, width, height) {
    const result = $("imageResult");
    if (!result) return;

    result.innerHTML = "";

    const heading = document.createElement("h3");
    heading.textContent = "Compression complete";

    const stats = document.createElement("div");
    stats.className = "stats";

    const change = file.size > 0
        ? ((blob.size - file.size) / file.size) * 100
        : 0;
    const changeLabel = change <= 0
        ? `${Math.abs(change).toFixed(1)}% smaller`
        : `${change.toFixed(1)}% larger`;

    [
        ["Before", formatBytes(file.size)],
        ["After", formatBytes(blob.size)],
        ["Size change", changeLabel]
    ].forEach(([label, value]) => {
        const stat = document.createElement("div");
        stat.className = "stat";
        const name = document.createElement("span");
        name.textContent = label;
        const amount = document.createElement("strong");
        amount.textContent = value;
        stat.append(name, amount);
        stats.append(stat);
    });

    const details = document.createElement("p");
    details.textContent = `Output dimensions: ${width} × ${height}`;

    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "Download compressed image";
    download.className = "download-link";
    download.addEventListener("click", () => downloadBlob(blob, filename));

    result.append(heading, stats, details, download);
    result.classList.remove("hidden");
}

function clearVideoPreview() {
    if (videoPreviewURL) {
        URL.revokeObjectURL(videoPreviewURL);
        videoPreviewURL = null;
    }

    $("videoPreviewElement")?.pause();

    if ($("videoPreviewElement")) {
        $("videoPreviewElement").removeAttribute("src");
        $("videoPreviewElement").load();
    }

    $("videoPreview")?.classList.add("hidden");
}

function clearImagePreview() {
    if (imagePreviewURL) {
        URL.revokeObjectURL(imagePreviewURL);
        imagePreviewURL = null;
    }

    if ($("imagePreviewElement")) {
        $("imagePreviewElement").removeAttribute("src");
    }

    $("imagePreview")?.classList.add("hidden");
}

function validateVideo(file) {
    if (!file) {
        throw new Error("Select a video first.");
    }

    if (file.size === 0) {
        throw new Error("The selected file is empty.");
    }

    if (file.size > MAX_VIDEO_SIZE) {
        throw new Error("Maximum video size is 5 GB.");
    }

    const extension = getExtension(file.name);

    if (
        file.type &&
        !file.type.startsWith("video/") &&
        !allowedVideoExtensions.includes(extension)
    ) {
        throw new Error("This file does not appear to be a supported video.");
    }

    return true;
}

function enableVideoButton(enabled = true) {
    const button = $("compressVideo");
    if (!button) return;

    button.disabled = !enabled;
}

function displayVideoFile(file) {
    try {
        validateVideo(file);
    } catch (error) {
        setStatus($("videoStatus"), error.message, "error");
        log(error.message, "error");
        return;
    }

    selectedVideo = file;

    $("videoName").textContent = file.name;
    $("videoDetails").textContent =
        `${formatBytes(file.size)} • ${file.type || "Unknown media type"}`;

    $("videoFileCard")?.classList.remove("hidden");
    $("videoResult")?.classList.add("hidden");

    clearVideoPreview();

    videoPreviewURL = URL.createObjectURL(file);

    if ($("videoPreviewElement")) {
        $("videoPreviewElement").src = videoPreviewURL;
    }

    $("videoPreview")?.classList.remove("hidden");

    setStatus($("videoStatus"), "");
    enableVideoButton(true);

    log(`Video selected: ${file.name} (${formatBytes(file.size)})`);
}

function displayImageFile(file) {
    if (!file || file.size === 0) {
        setStatus($("imageStatus"), "The selected file is empty or unavailable.", "error");
        return;
    }

    if (file.type && !file.type.startsWith("image/")) {
        setStatus($("imageStatus"), "Choose a supported image file.", "error");
        return;
    }

    selectedImage = file;

    $("imageName").textContent = file.name;
    $("imageDetails").textContent =
        `${formatBytes(file.size)} • ${file.type || "Image file"}`;

    $("imageFileCard")?.classList.remove("hidden");
    $("imageResult")?.classList.add("hidden");
    if ($("compressImage")) $("compressImage").disabled = false;

    clearImagePreview();

    imagePreviewURL = URL.createObjectURL(file);

    if ($("imagePreviewElement")) {
        $("imagePreviewElement").src = imagePreviewURL;
    }

    $("imagePreview")?.classList.remove("hidden");

    setStatus($("imageStatus"), "");
    log(`Image selected: ${file.name}`);
}

function getSelectedQuality() {
    const selected = ($("videoQuality")?.value || "medium").toLowerCase();

    if (selected === "low") return tools.QUALITY_LOW;
    if (selected === "large") return tools.QUALITY_HIGH;

    return tools.QUALITY_MEDIUM;
}

function getBitrateTarget(file) {
    const duration = $("videoPreviewElement")?.duration;

    if (!Number.isFinite(duration) || duration <= 0) return null;

    // Estimate source video bitrate by reserving a modest share for audio.
    const sourceBitrate = Math.max(0, (file.size * 8) / duration - 128_000);
    const targetPercent = Number($("videoBitrate")?.value || 70) / 100;

    // Avoid asking browser encoders for unusually high bitrates that may be unsupported.
    return Math.max(150_000, Math.min(12_000_000, Math.floor(sourceBitrate * targetPercent)));
}

function getResolutionHeight() {
    const value = $("videoResolution")?.value || "original";

    if (value === "original") return null;

    const height = Number(value);

    return Number.isFinite(height) && height > 0 ? height : null;
}

function getFrameRate() {
    const value = $("videoFps")?.value || "original";

    if (value === "original") return null;

    const fps = Number(value);

    return Number.isFinite(fps) && fps > 0 ? fps : null;
}

async function compressVideo() {
    if (activeJob) return;

    let input = null;
    let conversion = null;
    let completed = false;

    const button = $("compressVideo");

    try {
        const file = selectedVideo;

        validateVideo(file);

        activeJob = true;
        enableVideoButton(false);

        $("videoResult")?.classList.add("hidden");

        setStatus($("videoStatus"), "");
        showVideoProgress(true);
        setProgress(0, "Preparing compression...");

        log("Starting video compression.");

        if (file.size > 1024 * 1024 * 1024) {
            log("Large video selected. Memory usage may be high.", "warning");
        }

        startedAt = Date.now();
        setProgress(2, "Loading media engine...", "Elapsed: 0 seconds • Preparing encoder...");

        const engine = await loadEngine();
        setProgress(4, "Preparing video conversion...", `Elapsed: ${formatTime((Date.now() - startedAt) / 1000)} • Preparing encoder...`);

        input = new engine.Input({
            formats: engine.ALL_FORMATS,
            source: new engine.BlobSource(file)
        });

        setProgress(5, "Preparing video conversion...");

        let output = new engine.Output({
            format: new engine.Mp4OutputFormat(),
            target: new engine.BufferTarget()
        });

        const resolution = getResolutionHeight();
        const fps = getFrameRate();
        const quality = getSelectedQuality();
        const bitrate = getBitrateTarget(file);

        const videoOptions = async track => {
            const options = {
                codec: "avc",
                quality,
                hardwareAcceleration: "no-preference"
            };

            if (bitrate) {
                options.bitrate = bitrate;
            }

            if (resolution) {
                const sourceHeight = Number($("videoPreviewElement")?.videoHeight);
                options.height = sourceHeight > 0
                    ? Math.min(resolution, sourceHeight)
                    : resolution;
            }

            if (fps) {
                options.frameRate = fps;
            }

            return options;
        };

        const settings = {
            input,
            output,
            video: videoOptions
        };

        const audioSetting = ($("videoAudio")?.value || "keep").toLowerCase();

        if (
            audioSetting.includes("remove") ||
            audioSetting === "off" ||
            audioSetting === "none"
        ) {
            settings.audio = {
                discard: true
            };
        }

        conversion = await engine.Conversion.init(settings);

        if (!conversion.isValid) {
            const reasons = conversion.discardedTracks
                .map(item => item.reason || "Unsupported track")
                .join("; ");

            throw new Error(
                reasons || "This video cannot be converted by the current browser."
            );
        }

        if (conversion.discardedTracks.length) {
            log(
                `${conversion.discardedTracks.length} track(s) may not be included.`,
                "warning"
            );
        }

        const setProgressHandler = progress => {
            const normalizedProgress = Number.isFinite(progress)
                ? Math.max(0, Math.min(1, progress))
                : 0;
            const percent = Math.min(99, Math.max(5, normalizedProgress * 100));
            const elapsed = (Date.now() - startedAt) / 1000;
            const videoElement = $("videoPreviewElement");
            const duration = videoElement?.duration;
            const currentPosition = Number.isFinite(duration) && duration > 0
                ? duration * normalizedProgress
                : null;
            const dimensions = videoElement?.videoWidth && videoElement?.videoHeight
                ? `${videoElement.videoWidth}×${videoElement.videoHeight}`
                : "video";

            let remaining = "--";
            if (normalizedProgress > 0.01 && normalizedProgress < 1) {
                remaining = formatTime((elapsed / normalizedProgress) - elapsed);
            }

            const timeline = currentPosition === null
                ? "Source timeline unavailable"
                : `Estimated source segment: ${formatVideoPosition(currentPosition)} / ${formatVideoPosition(duration)}`;

            setProgress(
                percent,
                `Encoding ${dimensions} to MP4... ${Math.round(percent)}%`,
                `${timeline} • Elapsed: ${formatTime(elapsed)} • Estimated remaining: ${remaining}`
            );
        };
        conversion.onProgress = setProgressHandler;

        setStatus($("videoStatus"), "");
        setProgress(5, "Compression started...", `Elapsed: ${formatTime((Date.now() - startedAt) / 1000)} • Estimating remaining time...`);

        log("Conversion initialized.");

        try {
            await conversion.execute();
        } catch (error) {
            const message = error?.message || "";
            const encoderUnsupported = /encoder|configuration|not supported|not available|unsupported/i.test(message);

            if (!encoderUnsupported) throw error;

            log("The selected encoder settings are unsupported. Retrying with compatibility settings.", "warning");
            try {
                await conversion.cancel();
            } catch (_) {}

            input = new engine.Input({
                formats: engine.ALL_FORMATS,
                source: new engine.BlobSource(file)
            });
            output = new engine.Output({
                format: new engine.Mp4OutputFormat(),
                target: new engine.BufferTarget()
            });

            const fallbackVideoOptions = async track => {
                const options = {
                    codec: "avc",
                    quality: engine.QUALITY_LOW ?? quality,
                    hardwareAcceleration: "no-preference",
                    bitrate: Math.min(bitrate || 4_000_000, 4_000_000)
                };
                const sourceHeight = Number($("videoPreviewElement")?.videoHeight);
                if (sourceHeight > 0) options.height = Math.min(sourceHeight, 720);
                return options;
            };

            conversion = await engine.Conversion.init({ input, output, video: fallbackVideoOptions, ...(settings.audio ? { audio: settings.audio } : {}) });
            if (!conversion.isValid) {
                throw new Error("The browser cannot encode this video with the available compatibility settings.");
            }
            conversion.onProgress = setProgressHandler;
            await conversion.execute();
        }

        const buffer = output.target.buffer;

        if (!buffer || buffer.byteLength === 0) {
            throw new Error("The compressor produced an empty output file.");
        }

        const blob = new Blob([buffer], {
            type: "video/mp4"
        });

        const filename = safeFilename(file.name, "mp4");

        completed = true;

        setProgress(100, "Compression complete.", "Your video is ready to download.");

        showVideoResult(filename, file.size, blob.size, blob);

        setStatus($("videoStatus"), "Video compressed successfully.", "success");

        log("Video compression completed.", "success");
        log(`Original size: ${formatBytes(file.size)}`);
        log(`Compressed size: ${formatBytes(blob.size)}`);

        if (blob.size >= file.size) {
            log("The compressed file is not smaller than the original.", "warning");
        }
    } catch (error) {
        const details = error?.message || "An unknown error occurred.";
        const message = /memory|allocation|out of memory/i.test(details)
            ? "This video exceeded available browser memory. Try a smaller file or lower the resolution."
            : /encoder|configuration|not supported|not available|unsupported/i.test(details)
                ? "This browser could not encode the video with its available codecs. Try a lower resolution or frame rate, or use a different browser."
                : /network|fetch|import|module/i.test(details)
                    ? "The video engine could not be loaded. Check your connection and try again."
                    : details;

        setStatus($("videoStatus"), message, "error");
        setProgress(0, "Compression failed.", "Your original file is unchanged. Review the console for technical details.");

        log(`Video compression failed: ${details}`, "error");

        if (conversion && !completed) {
            try {
                await conversion.cancel();
            } catch (_) {}
        }
    } finally {
        activeJob = false;
        enableVideoButton(Boolean(selectedVideo));
    }
}

function getImageOutputType() {
    const value = ($("imageFormat")?.value || "image/jpeg").toLowerCase();

    const formats = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        "image/jpeg": "image/jpeg",
        "image/png": "image/png",
        "image/webp": "image/webp"
    };

    return formats[value] || "image/jpeg";
}

function getImageExtension(type) {
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    return "jpg";
}

async function compressImage() {
    if (activeJob) return;

    let sourceURL = null;

    try {
        const file = selectedImage;

        if (!file) {
            throw new Error("Select an image first.");
        }

        if (file.size === 0) {
            throw new Error("The selected file is empty.");
        }

        if (file.type && !file.type.startsWith("image/")) {
            throw new Error("The selected file is not a supported image.");
        }

        activeJob = true;

        if ($("compressImage")) {
            $("compressImage").disabled = true;
        }

        $("imageResult")?.classList.add("hidden");

        setStatus($("imageStatus"), "Compressing image...");
        log(`Starting image compression: ${file.name}`);

        const image = new Image();
        const imageLoaded = new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(
                new Error("The image could not be loaded or is not supported.")
            );
        });

        sourceURL = URL.createObjectURL(file);
        image.src = sourceURL;
        await imageLoaded;

        if (!image.naturalWidth || !image.naturalHeight) {
            throw new Error("The image has invalid dimensions.");
        }

        const maxSize = Number($("imageSize")?.value || 0);

        let width = image.naturalWidth;
        let height = image.naturalHeight;
        const dimensionScale = maxSize > 0
            ? Math.min(1, maxSize / Math.max(width, height))
            : 1;
        const pixelScale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));
        const scale = Math.min(dimensionScale, pixelScale);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));

        if (scale < dimensionScale) {
            log(`Image dimensions limited to protect browser memory (${width} × ${height}).`, "warning");
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const type = getImageOutputType();
        const context = canvas.getContext("2d", { alpha: type !== "image/jpeg" });

        if (!context) {
            throw new Error("Could not create the image processing canvas.");
        }

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        if (type === "image/jpeg") {
            context.fillStyle = $("jpegBackground")?.value || "#ffffff";
            context.fillRect(0, 0, width, height);
        }

        // Repeated half-size passes retain detail better for large reductions.
        let source = image;
        let sourceWidth = image.naturalWidth;
        let sourceHeight = image.naturalHeight;
        const intermediateCanvases = [];

        while (sourceWidth > width || sourceHeight > height) {
            const scale = Math.min(0.5, width / sourceWidth, height / sourceHeight);
            if (scale >= 1) break;

            const nextWidth = Math.max(width, Math.round(sourceWidth * scale));
            const nextHeight = Math.max(height, Math.round(sourceHeight * scale));
            const intermediate = document.createElement("canvas");
            intermediate.width = nextWidth;
            intermediate.height = nextHeight;
            const intermediateContext = intermediate.getContext("2d");
            if (!intermediateContext) break;
            intermediateContext.imageSmoothingEnabled = true;
            intermediateContext.imageSmoothingQuality = "high";
            intermediateContext.drawImage(source, 0, 0, nextWidth, nextHeight);

            if (source !== image) {
                source.width = 0;
                source.height = 0;
            }
            intermediateCanvases.push(intermediate);
            source = intermediate;
            sourceWidth = nextWidth;
            sourceHeight = nextHeight;
        }

        context.drawImage(source, 0, 0, width, height);
        for (const intermediate of intermediateCanvases) {
            intermediate.width = 0;
            intermediate.height = 0;
        }

        const qualityValue = Number($("imageQuality")?.value || 0.75);
        const quality = Math.max(0.1, Math.min(1, qualityValue));

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(
                result => {
                    if (result) resolve(result);
                    else reject(new Error("Image compression failed. Your browser may not support this output format."));
                },
                type,
                type === "image/png" ? undefined : quality
            );
        });

        const actualType = blob.type || type;
        const extension = getImageExtension(actualType);
        const filename = safeFilename(file.name, extension);

        showImageResult(file, filename, blob, width, height);

        setStatus($("imageStatus"), "Image compression complete.", "success");

        log(`Image compressed successfully: ${formatBytes(blob.size)}`, "success");
    } catch (error) {
        const message = error?.message || "Image compression failed.";

        setStatus($("imageStatus"), message, "error");
        log(message, "error");
    } finally {
        if (sourceURL) {
            URL.revokeObjectURL(sourceURL);
        }

        activeJob = false;

        if ($("compressImage")) {
            $("compressImage").disabled = !selectedImage;
        }
    }
}

function setupTabs() {
    const tabs = [
        [$("videoTab"), $("videoPanel")],
        [$("imageTab"), $("imagePanel")],
        [$("documentTab"), $("documentPanel")],
        [$("consoleTab"), $("consolePanel")]
    ];

    tabs.forEach(([tab, panel]) => {
        if (!tab || !panel) return;

        tab.addEventListener("click", () => {
            tabs.forEach(([otherTab, otherPanel]) => {
                otherTab?.classList.remove("active");
                otherTab?.setAttribute("aria-selected", "false");
                otherTab?.setAttribute("tabindex", "-1");
                otherPanel?.classList.add("hidden");
            });

            tab.classList.add("active");
            tab.setAttribute("aria-selected", "true");
            tab.setAttribute("tabindex", "0");
            panel.classList.remove("hidden");
        });

        tab.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const availableTabs = tabs.map(([item]) => item).filter(Boolean);
            const index = availableTabs.indexOf(tab);
            const nextIndex = event.key === "Home" ? 0
                : event.key === "End" ? availableTabs.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + availableTabs.length) % availableTabs.length;
            availableTabs[nextIndex].click();
            availableTabs[nextIndex].focus();
        });
    });
}

function setupDropZoneKeyboard(drop, input) {
    drop?.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        input?.click();
    });
}

function setupVideoInput() {
    const input = $("videoFile");
    const drop = $("videoDrop");
    setupDropZoneKeyboard(drop, input);

    input?.addEventListener("change", event => {
        const file = event.target.files?.[0];

        if (file) {
            displayVideoFile(file);
        }

        input.value = "";
    });

    drop?.addEventListener("click", event => {
        if (event.target.closest("button")) return;
        input?.click();
    });

    drop?.addEventListener("dragover", event => {
        event.preventDefault();
        drop.classList.add("drag");
    });

    drop?.addEventListener("dragleave", () => {
        drop.classList.remove("drag");
    });

    drop?.addEventListener("drop", event => {
        event.preventDefault();
        drop.classList.remove("drag");

        const file = event.dataTransfer?.files?.[0];

        if (file) {
            displayVideoFile(file);
        }
    });

    $("removeVideo")?.addEventListener("click", () => {
        selectedVideo = null;

        clearVideoPreview();

        $("videoFileCard")?.classList.add("hidden");
        $("videoResult")?.classList.add("hidden");

        setStatus($("videoStatus"), "");
        showVideoProgress(false);
        enableVideoButton(false);

        log("Video selection cleared.");
    });

    const button = $("compressVideo");

    if (button) {
        button.disabled = true;
        button.addEventListener("click", compressVideo);
    }
}

function setupImageInput() {
    const input = $("imageFile");
    const drop = $("imageDrop");
    setupDropZoneKeyboard(drop, input);

    input?.addEventListener("change", event => {
        const file = event.target.files?.[0];

        if (file) {
            displayImageFile(file);
        }

        input.value = "";
    });

    drop?.addEventListener("click", event => {
        if (event.target.closest("button")) return;
        input?.click();
    });

    drop?.addEventListener("dragover", event => {
        event.preventDefault();
        drop.classList.add("drag");
    });

    drop?.addEventListener("dragleave", () => {
        drop.classList.remove("drag");
    });

    drop?.addEventListener("drop", event => {
        event.preventDefault();
        drop.classList.remove("drag");

        const file = event.dataTransfer?.files?.[0];

        if (file && file.type.startsWith("image/")) {
            displayImageFile(file);
        } else {
            setStatus($("imageStatus"), "Drop a valid image file.", "error");
        }
    });

    if ($("compressImage")) {
        $("compressImage").disabled = true;
    }

    $("removeImage")?.addEventListener("click", () => {
        selectedImage = null;

        clearImagePreview();

        $("imageFileCard")?.classList.add("hidden");
        $("imageResult")?.classList.add("hidden");
        if ($("compressImage")) $("compressImage").disabled = true;

        setStatus($("imageStatus"), "");

        log("Image selection cleared.");
    });

    $("compressImage")?.addEventListener("click", compressImage);
}

const supportedDocumentExtensions = new Set(["pdf", "doc", "docx"]);

function displayDocumentFile(file) {
    const extension = getExtension(file.name);

    if (!supportedDocumentExtensions.has(extension)) {
        setStatus($("documentStatus"), "Choose a PDF or Word document.", "error");
        return;
    }

    if (file.size === 0) {
        setStatus($("documentStatus"), "The selected file is empty.", "error");
        return;
    }

    selectedDocument = file;
    $("documentName").textContent = file.name;
    $("documentDetails").textContent = `${formatBytes(file.size)} • ${file.type || "Document"}`;
    $("documentFileCard")?.classList.remove("hidden");
    $("documentResult")?.classList.add("hidden");
    showDocumentProgress(false);
    setDocumentProgress(0, "Preparing compression...", "Waiting to start.");
    setStatus($("documentStatus"), "");
    $("compressDocument").disabled = false;
    log(`Document selected: ${file.name} (${formatBytes(file.size)})`);
}

function setDocumentProgress(percent, message, hint = "") {
    const value = Math.max(0, Math.min(100, percent));
    if ($("documentPercent")) $("documentPercent").textContent = `${Math.round(value)}%`;
    if ($("documentBar")) $("documentBar").style.width = `${value}%`;
    if ($("documentProgressText")) $("documentProgressText").textContent = message;
    if ($("documentProgressHint")) $("documentProgressHint").textContent = hint;
}

function showDocumentProgress(show) {
    $("documentProgress")?.classList.toggle("hidden", !show);
}

function showDocumentResult(file, blob) {
    const result = $("documentResult");
    result.innerHTML = "";

    const heading = document.createElement("h3");
    heading.textContent = "Compressed copy ready";

    const stats = document.createElement("div");
    stats.className = "stats";
    const change = file.size > 0 ? ((blob.size - file.size) / file.size) * 100 : 0;
    const changeText = change <= 0
        ? `${Math.abs(change).toFixed(1)}% smaller`
        : `${change.toFixed(1)}% larger`;

    [["Before", formatBytes(file.size)], ["After", formatBytes(blob.size)], ["Size change", changeText]].forEach(([label, value]) => {
        const stat = document.createElement("div");
        stat.className = "stat";
        const name = document.createElement("span");
        name.textContent = label;
        const amount = document.createElement("strong");
        amount.textContent = value;
        stat.append(name, amount);
        stats.append(stat);
    });

    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "Download compressed document (.gz)";
    download.className = "download-link";
    download.addEventListener("click", () => {
        downloadBlob(blob, safeFilename(file.name, `${getExtension(file.name)}.gz`));
        log("Compressed document download started.", "success");
    });

    result.append(heading, stats, download);
    result.classList.remove("hidden");
}

async function compressDocument() {
    if (activeJob || !selectedDocument) return;

    const button = $("compressDocument");
    const file = selectedDocument;

    try {
        if (typeof CompressionStream === "undefined") {
            throw new Error("Gzip compression is not supported by this browser.");
        }

        activeJob = true;
        button.disabled = true;
        $("documentResult")?.classList.add("hidden");
        setStatus($("documentStatus"), "Creating a gzip archive locally. This does not optimize the document itself.");
        log(`Starting document compression: ${file.name}`);

        setDocumentProgress(0, "Preparing compression...", `Goal: ${$("documentTarget")?.value || 20}% smaller • Gzip reduction depends on file contents.`);
        showDocumentProgress(true);

        const compression = new CompressionStream("gzip");
        const writer = compression.writable.getWriter();
        const outputReader = compression.readable.getReader();
        const chunks = [];
        const collectOutput = (async () => {
            while (true) {
                const { value, done } = await outputReader.read();
                if (done) break;
                chunks.push(value);
            }
        })();

        const sourceReader = file.stream().getReader();
        let loaded = 0;
        try {
            while (true) {
                const { value, done } = await sourceReader.read();
                if (done) break;
                await writer.write(value);
                loaded += value.byteLength;
                const percent = file.size ? (loaded / file.size) * 100 : 100;
                setDocumentProgress(percent, `Compressing document... ${Math.round(percent)}%`, `${formatBytes(loaded)} of ${formatBytes(file.size)} processed • Goal: ${$("documentTarget")?.value || 20}% smaller`);
            }
            await writer.close();
            await collectOutput;
        } catch (error) {
            await sourceReader.cancel(error).catch(() => {});
            await writer.abort(error).catch(() => {});
            await outputReader.cancel(error).catch(() => {});
            await collectOutput.catch(() => {});
            throw error;
        } finally {
            sourceReader.releaseLock();
            writer.releaseLock();
            outputReader.releaseLock();
        }

        const blob = new Blob(chunks, { type: "application/gzip" });
        setDocumentProgress(100, "Compression complete.", "Your compressed copy is ready to download.");
        showDocumentResult(file, blob);
        const actualChange = file.size ? ((file.size - blob.size) / file.size) * 100 : 0;
        const goal = Number($("documentTarget")?.value || 20);
        const goalMessage = actualChange >= goal
            ? ` Requested reduction achieved (${actualChange.toFixed(1)}% smaller).`
            : ` Actual reduction: ${actualChange.toFixed(1)}%; the ${goal}% goal may not be achievable losslessly.`;
        setStatus($("documentStatus"), `Gzip archive is ready.${goalMessage}`, "success");
        log(`Document compression completed: ${formatBytes(blob.size)} (${actualChange.toFixed(1)}% smaller)`, "success");
    } catch (error) {
        const message = error?.message || "Document compression failed.";
        setStatus($("documentStatus"), message, "error");
        setDocumentProgress(0, "Compression failed.", message);
        log(`Document compression failed: ${message}`, "error");
    } finally {
        activeJob = false;
        button.disabled = !selectedDocument;
    }
}

function setupDocumentInput() {
    const input = $("documentFile");
    const drop = $("documentDrop");
    setupDropZoneKeyboard(drop, input);

    input?.addEventListener("change", event => {
        const file = event.target.files?.[0];
        if (file) displayDocumentFile(file);
        input.value = "";
    });

    drop?.addEventListener("click", () => input?.click());
    drop?.addEventListener("dragover", event => {
        event.preventDefault();
        drop.classList.add("drag");
    });
    drop?.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop?.addEventListener("drop", event => {
        event.preventDefault();
        drop.classList.remove("drag");
        const file = event.dataTransfer?.files?.[0];
        if (file) displayDocumentFile(file);
    });

    $("removeDocument")?.addEventListener("click", () => {
        selectedDocument = null;
        $("documentFileCard")?.classList.add("hidden");
        $("documentResult")?.classList.add("hidden");
        $("compressDocument").disabled = true;
        showDocumentProgress(false);
        setStatus($("documentStatus"), "");
        log("Document selection cleared.");
    });

    $("compressDocument")?.addEventListener("click", compressDocument);
    $("documentTarget")?.addEventListener("input", event => {
        $("documentTargetValue").textContent = `${event.target.value}%`;
    });
    $("videoBitrate")?.addEventListener("input", event => {
        $("videoBitrateValue").textContent = `${event.target.value}%`;
    });
    $("imageQuality")?.addEventListener("input", event => {
        $("imageQualityValue").textContent = `${Math.round(Number(event.target.value) * 100)}%`;
    });
    const updateImageFormatSettings = () => {
        const format = $("imageFormat")?.value;
        $("jpegBackgroundSetting")?.classList.toggle("hidden", format !== "image/jpeg");
        $("imageQualitySetting")?.classList.toggle("hidden", format === "image/png");
    };
    $("imageFormat")?.addEventListener("change", updateImageFormatSettings);
    updateImageFormatSettings();
}

function setupConsole() {
    $("clearConsole")?.addEventListener("click", () => {
        if ($("consoleOutput")) {
            $("consoleOutput").innerHTML = "";
        }

        log("Console cleared.");
    });
}

function setupParticleBackground() {
    const canvas = $("particleBackground");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const particles = [];
    let width = 0;
    let height = 0;
    let animationFrame = 0;

    function resize() {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        const count = Math.min(90, Math.max(35, Math.round((width * height) / 18000)));
        particles.length = 0;
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.22,
                vy: (Math.random() - 0.5) * 0.22,
                radius: Math.random() * 1.4 + 0.5,
                alpha: Math.random() * 0.45 + 0.2
            });
        }
    }

    function draw(animate) {
        context.clearRect(0, 0, width, height);

        for (const particle of particles) {
            if (animate) {
                particle.x += particle.vx;
                particle.y += particle.vy;
                if (particle.x < 0) particle.x = width;
                if (particle.x > width) particle.x = 0;
                if (particle.y < 0) particle.y = height;
                if (particle.y > height) particle.y = 0;
            }

            context.beginPath();
            context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            context.fillStyle = `rgba(174, 181, 255, ${particle.alpha})`;
            context.fill();
        }

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const a = particles[i];
                const b = particles[j];
                const distance = Math.hypot(a.x - b.x, a.y - b.y);
                if (distance < 105) {
                    context.beginPath();
                    context.moveTo(a.x, a.y);
                    context.lineTo(b.x, b.y);
                    context.strokeStyle = `rgba(129, 140, 248, ${(1 - distance / 105) * 0.12})`;
                    context.lineWidth = 0.6;
                    context.stroke();
                }
            }
        }

        if (animate) animationFrame = requestAnimationFrame(() => draw(true));
    }

    function updateMotion() {
        cancelAnimationFrame(animationFrame);
        draw(!reduceMotion.matches);
    }

    resize();
    updateMotion();
    window.addEventListener("resize", () => {
        resize();
        updateMotion();
    });
    reduceMotion.addEventListener?.("change", updateMotion);
}

function setupAccessGate() {
    const currentURL = new URL(window.location.href);
    let removedSensitiveQuery = false;
    for (const key of ["password", "passcode", "pwd"]) {
        if (currentURL.searchParams.has(key)) {
            currentURL.searchParams.delete(key);
            removedSensitiveQuery = true;
        }
    }
    if (removedSensitiveQuery) {
        const safeURL = `${currentURL.pathname}${currentURL.search}${currentURL.hash}`;
        window.history.replaceState(null, "", safeURL);
    }

    const form = $("accessForm");
    const gate = $("accessGate");
    const workspace = $("workspace");
    const passwordInput = $("accessPassword");
    const status = $("accessStatus");
    const togglePassword = $("togglePassword");

    togglePassword?.addEventListener("click", () => {
        if (!passwordInput) return;
        const showing = passwordInput.type === "password";
        passwordInput.type = showing ? "text" : "password";
        togglePassword.textContent = showing ? "Hide" : "Show";
        togglePassword.setAttribute("aria-label", `${showing ? "Hide" : "Show"} passcode`);
        togglePassword.setAttribute("aria-pressed", String(showing));
        passwordInput.focus();
    });

    form?.addEventListener("submit", async event => {
        event.preventDefault();

        const submitButton = $("accessSubmit");
        const verification = $("accessVerification");
        if (!passwordInput || !submitButton || submitButton.disabled) return;

        submitButton.disabled = true;
        passwordInput.disabled = true;
        submitButton.textContent = "Verifying…";
        verification?.classList.remove("hidden");
        verification?.setAttribute("aria-hidden", "false");
        setStatus(status, "Checking your password…");

        // Give the verification state time to be seen before checking locally.
        await new Promise(resolve => window.setTimeout(resolve, 650));
        const isValid = passwordInput.value === ACCESS_PASSWORD;

        verification?.classList.add("hidden");
        verification?.setAttribute("aria-hidden", "true");
        submitButton.disabled = false;
        passwordInput.disabled = false;
        submitButton.textContent = "Unlock workspace";

        if (!isValid) {
            setStatus(status, "That password isn’t correct. Please try again.", "error");
            passwordInput.select();
            return;
        }

        setStatus(status, "");
        gate?.classList.add("hidden");
        workspace?.classList.remove("hidden");
        workspace?.setAttribute("aria-hidden", "false");
        passwordInput.value = "";
        $("videoTab")?.focus();
        log("Workspace unlocked.", "success");
    });
}

function initialize() {
    setupParticleBackground();
    setupAccessGate();
    setupTabs();
    setupVideoInput();
    setupImageInput();
    setupDocumentInput();
    setupConsole();
    $("jpegBackgroundSetting")?.classList.toggle("hidden", $("imageFormat")?.value !== "image/jpeg");

    setStatus($("videoStatus"), "");
    setStatus($("imageStatus"), "");
    setStatus($("documentStatus"), "");

    showVideoProgress(false);

    log("CompressLab initialized.", "success");
    log("Maximum video input: 5 GB.");
    log("Video output format: MP4.");
    log("Browser download mode enabled.");
}

initialize();
