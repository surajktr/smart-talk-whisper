import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { fetchAudioForText } from "@/lib/gemini-audio";
import { ChevronLeft, ChevronRight, Play, Pause, Download, ChevronUp, ChevronDown } from "lucide-react";

interface QuizQuestion {
  question_en: string;
  question_hi: string;
  question_script: string;
  answer: string;
  options: string[];
  extra_details: string;
  extra_details_speech_script: string;
}

interface QuizData {
  date: string;
  data: QuizQuestion[];
}

interface AudioItem {
  index: number;
  question: QuizQuestion;
  audioBlob: Blob | null;
  status: "pending" | "downloading" | "done" | "error";
}

type DisplayPhase = "question" | "answer" | "details";

const Index = () => {
  const [jsonInput, setJsonInput] = useState("");
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showFooter, setShowFooter] = useState(true);
  const [displayPhase, setDisplayPhase] = useState<DisplayPhase>("question");
  const [isGenerating, setIsGenerating] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const { toast } = useToast();

  const clearTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const parseJson = () => {
    try {
      const parsed = JSON.parse(jsonInput) as QuizData;
      if (!parsed.data || !Array.isArray(parsed.data)) {
        throw new Error("Invalid format");
      }
      setQuizData(parsed);
      setAudioItems(
        parsed.data.map((q, i) => ({
          index: i,
          question: q,
          audioBlob: null,
          status: "pending",
        }))
      );
      setCurrentIndex(0);
      setDisplayPhase("question");
      toast({ title: `Loaded ${parsed.data.length} questions` });
      
      // Auto-start generating audio
      generateAllAudio(parsed.data);
    } catch (e) {
      toast({ title: "Invalid JSON format", variant: "destructive" });
    }
  };

  const generateAllAudio = async (questions: QuizQuestion[]) => {
    setIsGenerating(true);
    
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      setAudioItems((prev) =>
        prev.map((item) =>
          item.index === i ? { ...item, status: "downloading" } : item
        )
      );

      const script = `${q.question_script}. Answer is ${q.answer}. ${q.extra_details_speech_script}`;
      const blob = await fetchAudioForText(script);

      setAudioItems((prev) =>
        prev.map((item) =>
          item.index === i
            ? { ...item, audioBlob: blob, status: blob ? "done" : "error" }
            : item
        )
      );
    }
    
    setIsGenerating(false);
    toast({ title: "All audio generated!" });
  };

  const playCurrentQuestion = useCallback(() => {
    const item = audioItems[currentIndex];
    if (!item || item.status !== "done" || !item.audioBlob) {
      toast({ title: "Audio not ready yet", variant: "destructive" });
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }
    clearTimeouts();

    const url = URL.createObjectURL(item.audioBlob);
    const audio = new Audio(url);
    audioRef.current = audio;
    
    setIsPlaying(true);
    setDisplayPhase("question");
    
    // Show answer after 3 seconds
    const t1 = setTimeout(() => setDisplayPhase("answer"), 3000);
    // Show details after 6 seconds
    const t2 = setTimeout(() => setDisplayPhase("details"), 6000);
    timeoutsRef.current.push(t1, t2);
    
    audio.play();
    
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setIsPlaying(false);
      
      // Auto move to next question after 2 seconds
      const t3 = setTimeout(() => {
        if (currentIndex < audioItems.length - 1) {
          setCurrentIndex((prev) => prev + 1);
          setDisplayPhase("question");
        }
      }, 2000);
      timeoutsRef.current.push(t3);
    };
  }, [audioItems, currentIndex, toast]);

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    clearTimeouts();
    setIsPlaying(false);
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      stopPlayback();
      setCurrentIndex((prev) => prev - 1);
      setDisplayPhase("question");
    }
  };

  const goToNext = () => {
    if (currentIndex < audioItems.length - 1) {
      stopPlayback();
      setCurrentIndex((prev) => prev + 1);
      setDisplayPhase("question");
    }
  };

  // H key handler - play after 1 second delay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "h" && quizData && !isPlaying) {
        setTimeout(() => {
          playCurrentQuestion();
        }, 1000);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [quizData, playCurrentQuestion, isPlaying]);

  const mergeAndDownloadAll = async () => {
    const completed = audioItems.filter((a) => a.status === "done" && a.audioBlob);
    if (completed.length === 0) {
      toast({ title: "No audio to download", variant: "destructive" });
      return;
    }

    toast({ title: "Merging audio files..." });

    const audioDataArray: ArrayBuffer[] = [];
    let sampleRate = 24000;
    let numChannels = 1;
    let bitsPerSample = 16;

    for (const item of completed) {
      if (!item.audioBlob) continue;
      const arrayBuffer = await item.audioBlob.arrayBuffer();
      const view = new DataView(arrayBuffer);
      
      if (audioDataArray.length === 0) {
        sampleRate = view.getUint32(24, true);
        numChannels = view.getUint16(22, true);
        bitsPerSample = view.getUint16(34, true);
      }
      
      const pcmData = arrayBuffer.slice(44);
      audioDataArray.push(pcmData);
    }

    const totalSize = audioDataArray.reduce((sum, buf) => sum + buf.byteLength, 0);
    const mergedBuffer = new ArrayBuffer(44 + totalSize);
    const mergedView = new DataView(mergedBuffer);
    
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        mergedView.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    mergedView.setUint32(4, 36 + totalSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    mergedView.setUint32(16, 16, true);
    mergedView.setUint16(20, 1, true);
    mergedView.setUint16(22, numChannels, true);
    mergedView.setUint32(24, sampleRate, true);
    mergedView.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    mergedView.setUint16(32, numChannels * (bitsPerSample / 8), true);
    mergedView.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    mergedView.setUint32(40, totalSize, true);
    
    let offset = 44;
    for (const pcmData of audioDataArray) {
      new Uint8Array(mergedBuffer, offset).set(new Uint8Array(pcmData));
      offset += pcmData.byteLength;
    }
    
    const blob = new Blob([mergedBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quiz_${quizData?.date || 'audio'}_merged.wav`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: `Downloaded merged file (${completed.length} questions)` });
  };

  const parseExtraDetails = (details: string) => {
    const englishPoints: string[] = [];
    const hindiPoints: string[] = [];
    
    const lines = details.split('\n').filter(line => line.trim().startsWith('-'));
    
    lines.forEach(line => {
      const cleanLine = line.replace(/^-\s*\*\*/, '').replace(/\*\*/g, '').replace(/^-\s*/, '').trim();
      if (/[\u0900-\u097F]/.test(cleanLine)) {
        hindiPoints.push(cleanLine);
      } else {
        englishPoints.push(cleanLine);
      }
    });
    
    return { englishPoints, hindiPoints };
  };

  const currentQuestion = quizData?.data[currentIndex];
  const currentAudioItem = audioItems[currentIndex];
  const completedCount = audioItems.filter((a) => a.status === "done").length;

  // Initial JSON input view
  if (!quizData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-4">
          <h1 className="text-2xl font-bold text-center text-foreground">Quiz Voice Generator</h1>
          <Textarea
            placeholder="Paste your quiz JSON here..."
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            className="min-h-[300px] font-mono text-sm"
          />
          <Button onClick={parseJson} className="w-full" size="lg">
            Load Quiz
          </Button>
        </div>
      </div>
    );
  }

  const { englishPoints, hindiPoints } = currentQuestion 
    ? parseExtraDetails(currentQuestion.extra_details) 
    : { englishPoints: [], hindiPoints: [] };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Main Content */}
      <div className="flex-1 p-2 flex flex-col">
        {/* Question Card */}
        <div className="border-2 border-foreground rounded-lg p-4 sm:p-6 mb-3">
          <p className="text-lg sm:text-xl font-semibold text-foreground mb-2">
            {currentIndex + 1}. {currentQuestion?.question_en}
          </p>
          <p className="text-base sm:text-lg text-red-500 font-medium">
            {currentQuestion?.question_hi}
          </p>
        </div>

        {/* Options Grid */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {currentQuestion?.options.map((option, idx) => {
            const isCorrect = option === currentQuestion.answer;
            const showAsCorrect = displayPhase !== "question" && isCorrect;
            
            return (
              <button
                key={idx}
                className={`py-3 px-4 rounded-full border-2 text-center font-medium transition-all ${
                  showAsCorrect
                    ? "bg-green-500 border-green-500 text-white"
                    : "border-muted-foreground/30 text-foreground hover:border-primary"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>

        {/* Key Points - shown after answer phase */}
        {displayPhase === "details" && currentQuestion && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
            {/* English Key Points */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <h3 className="text-xl font-bold text-foreground mb-3">Key Points</h3>
              <ul className="space-y-2">
                {englishPoints.map((point, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-foreground text-sm">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Hindi Key Points */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <h3 className="text-xl font-bold text-red-500 mb-3">महत्वपूर्ण जानकारी</h3>
              <ul className="space-y-2">
                {hindiPoints.map((point, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-foreground text-sm">
                    <span className="text-red-500 mt-0.5">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Footer Toggle */}
      <button
        onClick={() => setShowFooter(!showFooter)}
        className="mx-auto mb-1 p-1 rounded-full hover:bg-muted"
      >
        {showFooter ? <ChevronDown className="h-6 w-6" /> : <ChevronUp className="h-6 w-6" />}
      </button>

      {/* Footer Controls */}
      {showFooter && (
        <div className="border-t bg-background p-3 flex items-center justify-between">
          {/* Left - Status */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[120px]">
            {isGenerating && (
              <span className="animate-pulse">Generating: {completedCount}/{audioItems.length}</span>
            )}
            {!isGenerating && currentAudioItem?.status === "downloading" && (
              <span className="animate-pulse">Downloading...</span>
            )}
            {!isGenerating && currentAudioItem?.status === "done" && (
              <span className="text-green-500">Ready</span>
            )}
          </div>

          {/* Center - Playback Controls */}
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="icon"
              className="rounded-full h-10 w-10 bg-primary"
              onClick={goToPrevious}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            
            <Button
              variant="default"
              size="icon"
              className="rounded-full h-12 w-12 bg-primary"
              onClick={isPlaying ? stopPlayback : playCurrentQuestion}
              disabled={currentAudioItem?.status !== "done"}
            >
              {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
            </Button>
            
            <Button
              variant="default"
              size="icon"
              className="rounded-full h-10 w-10 bg-primary"
              onClick={goToNext}
              disabled={currentIndex === audioItems.length - 1}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Right - Download & Counter */}
          <div className="flex items-center gap-3 min-w-[120px] justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={mergeAndDownloadAll}
              disabled={completedCount === 0}
            >
              <Download className="h-5 w-5" />
            </Button>
            <span className="text-sm font-medium">
              {currentIndex + 1} / {audioItems.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
