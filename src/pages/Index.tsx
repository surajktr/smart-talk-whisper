import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { fetchAudioForText } from "@/lib/gemini-audio";
import { ChevronLeft, ChevronRight, Play, Pause, Download, ChevronUp, ChevronDown } from "lucide-react";

// नए फ़ॉर्मेट के अनुसार इंटरफ़ेस
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
  const { toast } = useToast();

  useEffect(() => {
    audioItemsRef.current = audioItems;
  }, [audioItems]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

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
      toast({ title: `Loaded ${parsed.data.length} questions. Generating audio...` });

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

      // द्विभाषी आवाज़ जनरेशन
      const questionBlob = await fetchAudioForText(q.question_script);
      const answerBlob = await fetchAudioForText(`The correct answer is ${q.answer}. सही उत्तर है ${q.answer}.`);
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
    toast({ title: "All audio ready!" });
  };

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

    const questionUrl = URL.createObjectURL(item.questionAudio);
    const questionAudio = new Audio(questionUrl);
    audioRef.current = questionAudio;
    questionAudio.play();

    questionAudio.onended = () => {
      URL.revokeObjectURL(questionUrl);
      setDisplayPhase("answer");

      if (!item.answerAudio) {
        playDetails(item, index);
        return;
      }

      const answerUrl = URL.createObjectURL(item.answerAudio);
      const answerAudio = new Audio(answerUrl);
      audioRef.current = answerAudio;
      answerAudio.play();

      answerAudio.onended = () => {
        URL.revokeObjectURL(answerUrl);
        playDetails(item, index);
      };
    };
  }, [toast]);

  const playDetails = (item: AudioItem, index: number) => {
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

  const finishAndAdvance = (index: number) => {
    setIsPlaying(false);
    const items = audioItemsRef.current;
    if (autoPlayMode && index < items.length - 1) {
      setTimeout(() => {
        playQuestionAtIndex(index + 1);
      }, 1000);
    } else if (index >= items.length - 1) {
      setAutoPlayMode(false);
      toast({ title: "Quiz completed!" });
    }
  };

  const startAutoPlay = useCallback(() => {
    if (!allReady) {
      toast({ title: "Audio still generating...", variant: "destructive" });
      return;
    }
    setAutoPlayMode(true);
    setShowFooter(false);
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
        audioDataArray.push(arrayBuffer.slice(44));
      }
    }

    const totalSize = audioDataArray.reduce((sum, buf) => sum + buf.byteLength, 0);
    const mergedBuffer = new ArrayBuffer(44 + totalSize);
    const mergedView = new DataView(mergedBuffer);
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) mergedView.setUint8(offset + i, str.charCodeAt(i));
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
  };

  const parseExtraDetails = (details: string) => {
    const englishPoints: string[] = [];
    const hindiPoints: string[] = [];
    const lines = details.split('\n').filter(line => line.trim().startsWith('-'));
    lines.forEach(line => {
      const cleanLine = line.substring(1).trim().replace(/\*\*/g, '');
      if (/[\u0900-\u097F]/.test(cleanLine)) hindiPoints.push(cleanLine);
      else englishPoints.push(cleanLine);
    });
    return { englishPoints, hindiPoints };
  };

  const currentQuestion = quizData?.data[currentIndex];
  const completedCount = audioItems.filter((a) => a.status === "done").length;

  if (!quizData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-4">
          <h1 className="text-2xl font-bold text-center">Quiz Voice Generator</h1>
          <Textarea
            placeholder="Paste your quiz JSON here..."
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            className="min-h-[300px] font-mono text-sm"
          />
          <Button onClick={parseJson} className="w-full" size="lg">Load Quiz</Button>
        </div>
      </div>
    );
  }

  const { englishPoints, hindiPoints } = currentQuestion ? parseExtraDetails(currentQuestion.extra_details) : { englishPoints: [], hindiPoints: [] };
  const isAnswerRevealed = displayPhase !== "question";

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col">
      <div className="flex-1 w-full px-6 md:px-12 mx-auto flex flex-col gap-5 py-6 overflow-y-auto">
        <div className="bg-white border-2 border-black p-5 rounded-[15px] shadow-sm">
          <div className="text-lg font-bold mb-2 flex gap-2">
            <span>{currentIndex + 1}.</span>
            <span>{currentQuestion?.question_en}</span>
          </div>
          <div className="text-lg font-bold text-red-600 ml-[25px]">
            {currentQuestion?.question_hi}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-[15px]">
          {currentQuestion?.options.map((option, idx) => {
            const isCorrect = option === currentQuestion.answer;
            const isRevealedAndCorrect = isAnswerRevealed && isCorrect;
            return (
              <div
                key={idx}
                className={`relative py-3 px-5 rounded-[50px] font-semibold text-center border-2 transition-all flex items-center justify-center min-h-[52px] overflow-hidden
                  ${isRevealedAndCorrect ? 'bg-[#16A34A] border-[#16A34A] text-white' : 'bg-white border-[#102C57] text-[#102C57]'}`}
              >
                {/* ऑटो-लेबलिंग रेंडरिंग */}
                <span className="mr-2">{String.fromCharCode(65 + idx)}.</span>
                {option}
                {isRevealedAndCorrect && showConfetti && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[50px]">
                    {Array.from({ length: 15 }).map((_, j) => (
                      <ConfettiPiece key={j} style={{ left: `${Math.random() * 100}%`, top: '-10px', animationDelay: `${Math.random() * 0.5}s`, animationDuration: `${1 + Math.random()}s` }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className={`flex flex-col md:flex-row gap-5 transition-all duration-700 ${displayPhase === "details" && showDetails ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>
          <div className="flex-1 bg-white p-5 rounded-[15px] shadow-sm">
            <div className="text-[24px] font-bold text-[#0F5298] mb-[15px]">Key Points</div>
            <ul className="list-none">
              {englishPoints.map((point, idx) => (
                <li key={idx} className="relative pl-[20px] mb-[10px] text-[18px] font-bold text-[#333]">
                  <span className="absolute left-0 text-[#007bff]">•</span>{point}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex-1 bg-white p-5 rounded-[15px] shadow-sm">
            <div className="text-[24px] font-bold text-[#0F5298] mb-[15px]">महत्वपूर्ण जानकारी</div>
            <ul className="list-none">
              {hindiPoints.map((point, idx) => (
                <li key={idx} className="relative pl-[20px] mb-[10px] text-[18px] font-bold text-[#333]">
                  <span className="absolute left-0 text-[#007bff]">•</span>{point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <button onClick={() => setShowFooter(!showFooter)} className="mx-auto mb-1 p-1">
        {showFooter ? <ChevronDown /> : <ChevronUp />}
      </button>

      {showFooter && (
        <div className="border-t bg-white p-3 flex items-center justify-between shadow-md">
          <div className="text-sm text-muted-foreground min-w-[120px]">
            {isGenerating ? <span className="animate-pulse">Generating: {completedCount}/{audioItems.length}</span> : allReady && !isPlaying ? <span className="text-green-500 font-semibold">Ready</span> : isPlaying ? <span className="text-[#0F5298] animate-pulse">Playing...</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" className="rounded-full bg-[#102C57]" onClick={goToPrevious} disabled={currentIndex === 0 || isPlaying}><ChevronLeft /></Button>
            <Button size="icon" className="rounded-full h-12 w-12 bg-[#102C57]" onClick={isPlaying ? stopPlayback : startAutoPlay} disabled={!allReady}>{isPlaying ? <Pause /> : <Play />}</Button>
            <Button size="icon" className="rounded-full bg-[#102C57]" onClick={goToNext} disabled={currentIndex === audioItems.length - 1 || isPlaying}><ChevronRight /></Button>
          </div>
          <div className="flex items-center gap-3 min-w-[120px] justify-end">
            <Button variant="ghost" size="icon" onClick={mergeAndDownloadAll} disabled={completedCount === 0}><Download /></Button>
            <span className="text-sm font-semibold text-[#102C57]">{currentIndex + 1} / {audioItems.length}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
