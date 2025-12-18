import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Play, Download, Loader2, Volume2, CheckCircle, StopCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchAudioForText } from "@/lib/gemini-audio";

interface QuizItem {
  question_en: string;
  question_hi: string;
  question_script: string;
  answer: string;
  options: string[];
  extra_details: string;
  extra_details_speech_script: string;
  image_prompt: string;
}

interface QuizData {
  date: string;
  data: QuizItem[];
}

interface AudioItem {
  index: number;
  text: string;
  audioBlob: Blob | null;
  status: "pending" | "generating" | "done" | "error";
}

const Index = () => {
  const [jsonInput, setJsonInput] = useState("");
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentPlaying, setCurrentPlaying] = useState<number | null>(null);
  const [shouldStop, setShouldStop] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  const parseJson = () => {
    try {
      const parsed = JSON.parse(jsonInput) as QuizData;
      setQuizData(parsed);
      setAudioItems(
        parsed.data.map((item, index) => ({
          index,
          text: `Question number ${index + 1}. ${item.question_script}. The answer is ${item.answer}. ${item.extra_details_speech_script}`,
          audioBlob: null,
          status: "pending" as const,
        }))
      );
      toast({ title: "JSON parsed", description: `Found ${parsed.data.length} questions` });
    } catch (error) {
      toast({ title: "Invalid JSON", variant: "destructive" });
    }
  };

  const generateAllAudio = async () => {
    if (!quizData || isGenerating) return;
    setIsGenerating(true);
    setShouldStop(false);

    for (let i = 0; i < audioItems.length; i++) {
      if (shouldStop) break;

      setAudioItems((prev) =>
        prev.map((item) => (item.index === i ? { ...item, status: "generating" } : item))
      );

      const audioBlob = await fetchAudioForText(audioItems[i].text);

      setAudioItems((prev) =>
        prev.map((item) =>
          item.index === i
            ? { ...item, audioBlob, status: audioBlob ? "done" : "error" }
            : item
        )
      );

      // Small delay between API calls
      await new Promise((r) => setTimeout(r, 300));
    }

    setIsGenerating(false);
    toast({ title: "Generation complete!" });
  };

  const stopGeneration = () => {
    setShouldStop(true);
    setIsGenerating(false);
  };

  const playAudio = (index: number) => {
    const item = audioItems.find((a) => a.index === index);
    if (!item?.audioBlob) return;

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const url = URL.createObjectURL(item.audioBlob);
    const audio = new Audio(url);
    audioRef.current = audio;
    setCurrentPlaying(index);
    
    audio.onended = () => {
      setCurrentPlaying(null);
      URL.revokeObjectURL(url);
    };
    audio.play();
  };

  const downloadSingle = (index: number) => {
    const item = audioItems.find((a) => a.index === index);
    if (!item?.audioBlob) return;

    const url = URL.createObjectURL(item.audioBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `question_${index + 1}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mergeAndDownloadAll = async () => {
    const completed = audioItems.filter((a) => a.status === "done" && a.audioBlob);
    if (completed.length === 0) {
      toast({ title: "No audio to download", variant: "destructive" });
      return;
    }

    toast({ title: "Merging audio files..." });

    // Read all WAV files and extract PCM data
    const audioDataArray: ArrayBuffer[] = [];
    let sampleRate = 24000;
    let numChannels = 1;
    let bitsPerSample = 16;

    for (const item of completed) {
      if (!item.audioBlob) continue;
      const arrayBuffer = await item.audioBlob.arrayBuffer();
      const view = new DataView(arrayBuffer);
      
      // Read WAV header info from first file
      if (audioDataArray.length === 0) {
        sampleRate = view.getUint32(24, true);
        numChannels = view.getUint16(22, true);
        bitsPerSample = view.getUint16(34, true);
      }
      
      // Extract PCM data (skip 44-byte header)
      const pcmData = arrayBuffer.slice(44);
      audioDataArray.push(pcmData);
    }

    // Calculate total size
    const totalSize = audioDataArray.reduce((sum, buf) => sum + buf.byteLength, 0);
    
    // Create merged WAV file
    const mergedBuffer = new ArrayBuffer(44 + totalSize);
    const mergedView = new DataView(mergedBuffer);
    
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        mergedView.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    
    // Write WAV header
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
    
    // Write all PCM data
    let offset = 44;
    for (const pcmData of audioDataArray) {
      new Uint8Array(mergedBuffer, offset).set(new Uint8Array(pcmData));
      offset += pcmData.byteLength;
    }
    
    // Download merged file
    const blob = new Blob([mergedBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quiz_${quizData?.date || 'audio'}_merged.wav`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: `Downloaded merged file (${completed.length} questions)` });
  };

  const completedCount = audioItems.filter((a) => a.status === "done").length;
  const totalCount = audioItems.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="text-center py-6">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
            Quiz Voice Generator
          </h1>
          <p className="text-slate-400">Generate audio with Gemini TTS (Kore voice)</p>
        </header>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-slate-200">Paste Quiz JSON</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder='{"date": "...", "data": [...]}'
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              className="min-h-[160px] font-mono text-sm bg-slate-900 border-slate-600 text-slate-200"
            />
            <Button onClick={parseJson} className="w-full bg-purple-600 hover:bg-purple-700">
              Parse JSON
            </Button>
          </CardContent>
        </Card>

        {quizData && (
          <>
            <Card className="bg-slate-800/50 border-purple-500/30">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-slate-200">
                  <span>{quizData.date}</span>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-full border-4 border-purple-500/30 flex items-center justify-center bg-slate-900">
                        <span className="text-2xl font-bold text-purple-400">{completedCount}</span>
                      </div>
                      <div className="absolute -bottom-1 -right-1 bg-slate-700 rounded-full px-2 py-0.5 text-xs text-slate-300">
                        /{totalCount}
                      </div>
                    </div>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={progressPercent} className="h-3 bg-slate-700" />
                <div className="flex gap-3">
                  {!isGenerating ? (
                    <Button
                      onClick={generateAllAudio}
                      className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                      size="lg"
                    >
                      <Volume2 className="mr-2 h-5 w-5" />
                      Generate All Audio
                    </Button>
                  ) : (
                    <Button
                      onClick={stopGeneration}
                      variant="destructive"
                      className="flex-1"
                      size="lg"
                    >
                      <StopCircle className="mr-2 h-5 w-5" />
                      Stop
                    </Button>
                  )}
                  <Button
                    onClick={mergeAndDownloadAll}
                    variant="outline"
                    size="lg"
                    disabled={completedCount === 0}
                    className="border-purple-500/50 text-purple-300 hover:bg-purple-500/20"
                  >
                    <Download className="mr-2 h-5 w-5" />
                    Download Merged ({completedCount})
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-3">
              {quizData.data.map((item, index) => {
                const audioItem = audioItems[index];
                const isPlaying = currentPlaying === index;

                return (
                  <Card
                    key={index}
                    className={`transition-all bg-slate-800/50 border-slate-700 ${
                      isPlaying ? "ring-2 ring-purple-500" : ""
                    } ${audioItem?.status === "done" ? "border-green-500/50" : ""}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                            audioItem?.status === "done"
                              ? "bg-green-500"
                              : audioItem?.status === "generating"
                              ? "bg-yellow-500 animate-pulse"
                              : audioItem?.status === "error"
                              ? "bg-red-500"
                              : "bg-slate-600"
                          }`}
                        >
                          {audioItem?.status === "done" ? (
                            <CheckCircle className="h-6 w-6 text-white" />
                          ) : audioItem?.status === "generating" ? (
                            <Loader2 className="h-6 w-6 text-white animate-spin" />
                          ) : (
                            <span className="font-bold text-white">{index + 1}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-200 mb-2">{item.question_script}</p>
                          <p className="text-sm text-slate-400 line-clamp-2 mb-2">
                            {item.extra_details_speech_script}
                          </p>
                          <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-1 rounded-full">
                            Answer: {item.answer}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => playAudio(index)}
                            disabled={audioItem?.status !== "done"}
                            className="border-slate-600 text-slate-300"
                          >
                            {isPlaying ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => downloadSingle(index)}
                            disabled={audioItem?.status !== "done"}
                            className="border-slate-600 text-slate-300"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Index;
