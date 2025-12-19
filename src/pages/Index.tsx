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
  questionAudio: Blob | null;
  answerAudio: Blob | null;
  detailsAudio: Blob | null;
  status: "pending" | "downloading" | "done" | "error";
}

type DisplayPhase = "question" | "answer" | "details";

// Confetti piece component
const ConfettiPiece: React.FC<{ style: React.CSSProperties }> = ({ style }) => {
  const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800'];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];
  return (
    <div 
      className="absolute w-2 h-2 rounded-sm animate-confetti-fall"
      style={{ ...style, backgroundColor: randomColor }} 
    />
  );
};

const Index = () => {
  const [jsonInput, setJsonInput] = useState("");
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showFooter, setShowFooter] = useState(true);
  const [displayPhase, setDisplayPhase] = useState<DisplayPhase>("question");
  const [isGenerating, setIsGenerating] = useState(false);
  const [allReady, setAllReady] = useState(false);
  const [autoPlayMode, setAutoPlayMode] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioItemsRef = useRef<AudioItem[]>([]);
  const currentIndexRef = useRef(0);
  const autoPlayModeRef = useRef(false);
  const { toast } = useToast();

  // Keep autoPlayMode ref in sync
  useEffect(() => {
    autoPlayModeRef.current = autoPlayMode;
  }, [autoPlayMode]);

  // Keep refs in sync
  useEffect(() => {
    audioItemsRef.current = audioItems;
  }, [audioItems]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Handle phase changes for confetti and details
  useEffect(() => {
    if (displayPhase === "answer") {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    } else {
      setShowConfetti(false);
    }
  }, [displayPhase, currentIndex]);

  useEffect(() => {
    if (displayPhase === "details") {
      const timer = setTimeout(() => setShowDetails(true), 500);
      return () => clearTimeout(timer);
    } else {
      setShowDetails(false);
    }
  }, [displayPhase, currentIndex]);

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
          questionAudio: null,
          answerAudio: null,
          detailsAudio: null,
          status: "pending",
        }))
      );
      setCurrentIndex(0);
      setDisplayPhase("question");
      setAllReady(false);
      setAutoPlayMode(false);
      toast({ title: `Loaded ${parsed.data.length} questions` });

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

      const questionBlob = await fetchAudioForText(q.question_script);
      const answerBlob = await fetchAudioForText(`The correct answer is ${q.answer}`);
      const detailsBlob = await fetchAudioForText(q.extra_details_speech_script);

      setAudioItems((prev) =>
        prev.map((item) =>
          item.index === i
            ? {
              ...item,
              questionAudio: questionBlob,
              answerAudio: answerBlob,
              detailsAudio: detailsBlob,
              status: (questionBlob && answerBlob && detailsBlob) ? "done" : "error"
            }
            : item
        )
      );
    }

    setIsGenerating(false);
    setAllReady(true);
    toast({ title: "All audio ready! Press H to start." });
  };

  const finishAndAdvance = useCallback((index: number) => {
    setIsPlaying(false);

    const items = audioItemsRef.current;
    const isAutoPlay = autoPlayModeRef.current;
    
    console.log("finishAndAdvance called", { index, isAutoPlay, totalItems: items.length });
    
    if (isAutoPlay && index < items.length - 1) {
      console.log("Auto-advancing to next question:", index + 1);
      // Will trigger playQuestionAtIndex after delay
      setTimeout(() => {
        const nextIndex = index + 1;
        const nextItem = audioItemsRef.current[nextIndex];
        
        if (!nextItem || nextItem.status !== "done" || !nextItem.questionAudio) {
          toast({ title: "Audio not ready yet", variant: "destructive" });
          setAutoPlayMode(false);
          return;
        }

        if (audioRef.current) {
          audioRef.current.pause();
        }

        setCurrentIndex(nextIndex);
        setIsPlaying(true);
        setDisplayPhase("question");

        playAudioSequence(nextItem, nextIndex);
      }, 1000);
    } else if (index >= items.length - 1) {
      setAutoPlayMode(false);
      toast({ title: "Quiz completed!" });
    }
  }, [toast]);

  const playAudioSequence = useCallback((item: AudioItem, index: number) => {
    const questionUrl = URL.createObjectURL(item.questionAudio!);
    const questionAudio = new Audio(questionUrl);
    audioRef.current = questionAudio;
    questionAudio.play();

    questionAudio.onended = () => {
      URL.revokeObjectURL(questionUrl);
      setDisplayPhase("answer");

      if (!item.answerAudio) {
        // Skip to details
        setDisplayPhase("details");
        if (!item.detailsAudio) {
          finishAndAdvance(index);
          return;
        }
        const detailsUrl = URL.createObjectURL(item.detailsAudio);
        const detailsAudio = new Audio(detailsUrl);
        audioRef.current = detailsAudio;
        detailsAudio.play();
        detailsAudio.onended = () => {
          URL.revokeObjectURL(detailsUrl);
          finishAndAdvance(index);
        };
        return;
      }

      const answerUrl = URL.createObjectURL(item.answerAudio);
      const answerAudio = new Audio(answerUrl);
      audioRef.current = answerAudio;
      answerAudio.play();

      answerAudio.onended = () => {
        URL.revokeObjectURL(answerUrl);
        setDisplayPhase("details");

        if (!item.detailsAudio) {
          finishAndAdvance(index);
          return;
        }

        const detailsUrl = URL.createObjectURL(item.detailsAudio);
        const detailsAudio = new Audio(detailsUrl);
        audioRef.current = detailsAudio;
        detailsAudio.play();

        detailsAudio.onended = () => {
          URL.revokeObjectURL(detailsUrl);
          finishAndAdvance(index);
        };
      };
    };
  }, [finishAndAdvance]);

  const playQuestionAtIndex = useCallback((index: number) => {
    const items = audioItemsRef.current;
    const item = items[index];

    if (!item || item.status !== "done" || !item.questionAudio) {
      toast({ title: "Audio not ready yet", variant: "destructive" });
      setAutoPlayMode(false);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    setCurrentIndex(index);
    setIsPlaying(true);
    setDisplayPhase("question");

    playAudioSequence(item, index);
  }, [toast, playAudioSequence]);

  const startAutoPlay = useCallback(() => {
    if (!allReady) {
      toast({ title: "Audio still generating...", variant: "destructive" });
      return;
    }
    setAutoPlayMode(true);
    setShowFooter(false); // Collapse footer when starting
    playQuestionAtIndex(currentIndexRef.current);
  }, [allReady, playQuestionAtIndex, toast]);

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setAutoPlayMode(false);
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

  // H key handler - start auto-play after 1 second delay and collapse footer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "h" && quizData && allReady && !isPlaying) {
        setShowFooter(false); // Collapse footer immediately
        setTimeout(() => {
          startAutoPlay();
        }, 1000);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [quizData, allReady, isPlaying, startAutoPlay]);

  const mergeAndDownloadAll = async () => {
    const completed = audioItems.filter((a) => a.status === "done" && a.questionAudio);
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
      const audios = [item.questionAudio, item.answerAudio, item.detailsAudio].filter(Boolean) as Blob[];

      for (const blob of audios) {
        const arrayBuffer = await blob.arrayBuffer();
        const view = new DataView(arrayBuffer);

        if (audioDataArray.length === 0) {
          sampleRate = view.getUint32(24, true);
          numChannels = view.getUint16(22, true);
          bitsPerSample = view.getUint16(34, true);
        }

        const pcmData = arrayBuffer.slice(44);
        audioDataArray.push(pcmData);
      }
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
      const cleanLine = line.substring(1).trim().replace(/\*\*/g, '');
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

  const isAnswerRevealed = displayPhase !== "question";

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col">
      {/* Main Content */}
      <div className="flex-1 w-full px-6 md:px-12 mx-auto flex flex-col gap-5 py-6 overflow-y-auto">
        
        {/* Question Box */}
        <div className="bg-white text-black border-2 border-black p-5 rounded-[15px] shadow-[0_4px_10px_rgba(0,0,0,0.1)]">
          <div className="text-lg md:text-[18px] font-bold mb-2 leading-[1.4] flex gap-2">
            <span>{currentIndex + 1}.</span>
            <span>{currentQuestion?.question_en}</span>
          </div>
          <div className="text-lg md:text-[18px] font-bold text-red-600 ml-[25px]">
            {currentQuestion?.question_hi}
          </div>
        </div>

        {/* Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[15px]">
          {currentQuestion?.options.map((option, idx) => {
            const isCorrect = option === currentQuestion.answer;
            const isRevealedAndCorrect = isAnswerRevealed && isCorrect;

            return (
              <div
                key={idx}
                className={`relative py-3 px-5 rounded-[50px] text-[16px] font-semibold cursor-pointer text-center border-2 transition-all duration-300 flex items-center justify-center min-h-[52px] overflow-hidden
                  ${isRevealedAndCorrect
                    ? 'bg-[#16A34A] border-[#16A34A] text-white shadow-[0_4px_10px_rgba(22,163,74,0.3)]'
                    : 'bg-white border-[#102C57] text-[#102C57] hover:bg-[#f0f8ff]'
                  }`}
              >
                {/* Confetti */}
                {isRevealedAndCorrect && showConfetti && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[50px]">
                    {Array.from({ length: 15 }).map((_, j) => (
                      <ConfettiPiece
                        key={j}
                        style={{
                          left: `${Math.random() * 100}%`,
                          top: '-10px',
                          animationDelay: `${Math.random() * 0.5}s`,
                          animationDuration: `${1 + Math.random()}s`,
                        }}
                      />
                    ))}
                  </div>
                )}
                {option}
              </div>
            );
          })}
        </div>

        {/* Info Cards - shown in details phase */}
        <div className={`flex flex-col md:flex-row gap-5 transition-all duration-700 ease-in-out ${
          displayPhase === "details" && showDetails 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-4 pointer-events-none h-0 overflow-hidden'
        }`}>
          
          {/* Key Points Card */}
          <div className="flex-1 bg-white p-5 rounded-[15px] shadow-[0_4px_15px_rgba(0,0,0,0.05)]">
            <div className="text-[24px] font-bold text-[#0F5298] mb-[15px]">Key Points</div>
            <ul className="list-none">
              {englishPoints.map((point, idx) => (
                <li key={idx} className="relative pl-[20px] mb-[10px] text-[18px] font-bold text-[#333] leading-[1.5]">
                  <span className="absolute left-0 top-[-2px] text-[#007bff] font-bold text-[20px]">•</span>
                  {point}
                </li>
              ))}
              {englishPoints.length === 0 && (
                <li className="text-gray-400 italic text-sm">No additional English details available.</li>
              )}
            </ul>
          </div>

          {/* Hindi Details Card */}
          <div className="flex-1 bg-white p-5 rounded-[15px] shadow-[0_4px_15px_rgba(0,0,0,0.05)]">
            <div className="text-[24px] font-bold text-[#0F5298] mb-[15px]">महत्वपूर्ण जानकारी</div>
            <ul className="list-none">
              {hindiPoints.map((point, idx) => (
                <li key={idx} className="relative pl-[20px] mb-[10px] text-[18px] font-bold text-[#333] leading-[1.5]">
                  <span className="absolute left-0 top-[-2px] text-[#007bff] font-bold text-[20px]">•</span>
                  {point}
                </li>
              ))}
              {hindiPoints.length === 0 && (
                <li className="text-gray-400 italic text-sm">कोई अतिरिक्त जानकारी उपलब्ध नहीं है।</li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Footer Toggle */}
      <button
        onClick={() => setShowFooter(!showFooter)}
        className="mx-auto mb-1 p-1 rounded-full hover:bg-white/50"
      >
        {showFooter ? <ChevronDown className="h-6 w-6" /> : <ChevronUp className="h-6 w-6" />}
      </button>

      {/* Footer Controls */}
      {showFooter && (
        <div className="border-t bg-white p-3 flex items-center justify-between shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
          {/* Left - Status */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[120px]">
            {isGenerating && (
              <span className="animate-pulse">Generating: {completedCount}/{audioItems.length}</span>
            )}
            {!isGenerating && allReady && !isPlaying && (
              <span className="text-green-500 font-semibold">Ready - Press H</span>
            )}
            {!isGenerating && isPlaying && (
              <span className="text-[#0F5298] animate-pulse font-semibold">Playing...</span>
            )}
          </div>

          {/* Center - Playback Controls */}
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="icon"
              className="rounded-full h-10 w-10 bg-[#102C57] hover:bg-[#1a3d6e]"
              onClick={goToPrevious}
              disabled={currentIndex === 0 || isPlaying}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <Button
              variant="default"
              size="icon"
              className="rounded-full h-12 w-12 bg-[#102C57] hover:bg-[#1a3d6e]"
              onClick={isPlaying ? stopPlayback : startAutoPlay}
              disabled={!allReady}
            >
              {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
            </Button>

            <Button
              variant="default"
              size="icon"
              className="rounded-full h-10 w-10 bg-[#102C57] hover:bg-[#1a3d6e]"
              onClick={goToNext}
              disabled={currentIndex === audioItems.length - 1 || isPlaying}
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
            <span className="text-sm font-semibold text-[#102C57]">
              {currentIndex + 1} / {audioItems.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
