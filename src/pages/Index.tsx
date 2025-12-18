import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Play, Download, Loader2, Volume2, Pause, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  status: "pending" | "playing" | "done";
}

const Index = () => {
  const [jsonInput, setJsonInput] = useState("");
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [playedCount, setPlayedCount] = useState(0);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const { toast } = useToast();

  const parseJson = () => {
    try {
      const parsed = JSON.parse(jsonInput) as QuizData;
      setQuizData(parsed);
      setAudioItems(
        parsed.data.map((item, index) => ({
          index,
          text: `Question ${index + 1}. ${item.question_script}. Answer is ${item.answer}. ${item.extra_details_speech_script}`,
          status: "pending" as const,
        }))
      );
      setPlayedCount(0);
      toast({ title: "JSON parsed successfully", description: `Found ${parsed.data.length} questions` });
    } catch (error) {
      toast({ title: "Invalid JSON", description: "Please check your JSON format", variant: "destructive" });
    }
  };

  const speakText = (text: string, index: number) => {
    return new Promise<void>((resolve) => {
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "hi-IN";
      utterance.rate = 0.9;
      utterance.pitch = 1.1;
      
      // Try to find a female Hindi voice
      const voices = window.speechSynthesis.getVoices();
      const hindiVoice = voices.find(v => v.lang.includes("hi") && v.name.toLowerCase().includes("female")) 
        || voices.find(v => v.lang.includes("hi"))
        || voices.find(v => v.name.toLowerCase().includes("female"));
      
      if (hindiVoice) {
        utterance.voice = hindiVoice;
      }

      utterance.onend = () => {
        setAudioItems(prev => 
          prev.map(item => item.index === index ? { ...item, status: "done" } : item)
        );
        setPlayedCount(prev => prev + 1);
        resolve();
      };

      utterance.onerror = () => {
        resolve();
      };

      speechRef.current = utterance;
      setCurrentIndex(index);
      setAudioItems(prev => 
        prev.map(item => item.index === index ? { ...item, status: "playing" } : item)
      );
      window.speechSynthesis.speak(utterance);
    });
  };

  const playAll = async () => {
    if (!quizData || isPlaying) return;
    setIsPlaying(true);
    setPlayedCount(0);
    
    // Reset all to pending
    setAudioItems(prev => prev.map(item => ({ ...item, status: "pending" })));

    for (let i = 0; i < audioItems.length; i++) {
      if (!isPlaying) break;
      await speakText(audioItems[i].text, i);
      // Small pause between questions
      await new Promise(r => setTimeout(r, 1000));
    }

    setIsPlaying(false);
    setCurrentIndex(null);
    toast({ title: "Playback complete!", description: "All questions have been read" });
  };

  const playSingle = (index: number) => {
    const item = audioItems[index];
    if (!item) return;
    speakText(item.text, index);
  };

  const stopPlayback = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setCurrentIndex(null);
  };

  const downloadTranscript = () => {
    if (!quizData) return;
    
    let content = `Quiz Date: ${quizData.date}\n\n`;
    quizData.data.forEach((item, idx) => {
      content += `Question ${idx + 1}:\n`;
      content += `${item.question_script}\n`;
      content += `Answer: ${item.answer}\n`;
      content += `Details: ${item.extra_details_speech_script}\n\n`;
    });

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quiz_${quizData.date.replace(/\s/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "Downloaded!", description: "Transcript saved as text file" });
  };

  const completedCount = audioItems.filter(a => a.status === "done").length;
  const totalCount = audioItems.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="text-center py-6">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent mb-2">
            Quiz Voice Reader
          </h1>
          <p className="text-muted-foreground">Paste your JSON and listen to questions with TTS</p>
        </header>

        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-lg">JSON Input</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder='{"date": "...", "data": [...]}'
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              className="min-h-[180px] font-mono text-sm"
            />
            <Button onClick={parseJson} className="w-full" size="lg">
              Parse JSON
            </Button>
          </CardContent>
        </Card>

        {quizData && (
          <>
            <Card className="border-2 border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Progress: {quizData.date}</span>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div className="w-14 h-14 rounded-full border-4 border-primary/20 flex items-center justify-center">
                        <span className="text-xl font-bold text-primary">{completedCount}</span>
                      </div>
                      <div className="absolute -bottom-1 -right-1 bg-muted rounded-full px-2 py-0.5 text-xs">
                        /{totalCount}
                      </div>
                    </div>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={progressPercent} className="h-4" />
                <div className="flex gap-3">
                  {!isPlaying ? (
                    <Button onClick={playAll} className="flex-1" size="lg">
                      <Volume2 className="mr-2 h-5 w-5" />
                      Play All Questions
                    </Button>
                  ) : (
                    <Button onClick={stopPlayback} variant="destructive" className="flex-1" size="lg">
                      <Pause className="mr-2 h-5 w-5" />
                      Stop Playback
                    </Button>
                  )}
                  <Button
                    onClick={downloadTranscript}
                    variant="outline"
                    size="lg"
                  >
                    <Download className="mr-2 h-5 w-5" />
                    Download
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-3">
              {quizData.data.map((item, index) => {
                const audioItem = audioItems[index];
                const isCurrentPlaying = currentIndex === index;
                
                return (
                  <Card 
                    key={index} 
                    className={`transition-all duration-300 ${
                      isCurrentPlaying ? "ring-2 ring-primary shadow-lg" : ""
                    } ${audioItem?.status === "done" ? "bg-green-50 dark:bg-green-950/20" : ""}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                            audioItem?.status === "done"
                              ? "bg-green-500 text-white"
                              : audioItem?.status === "playing"
                              ? "bg-primary text-primary-foreground animate-pulse"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {audioItem?.status === "done" ? (
                            <CheckCircle className="h-6 w-6" />
                          ) : (
                            <span className="font-bold">{index + 1}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground mb-2 leading-relaxed">
                            {item.question_script}
                          </p>
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                            {item.extra_details_speech_script}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                              Answer: {item.answer}
                            </span>
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant={isCurrentPlaying ? "default" : "outline"}
                          onClick={() => playSingle(index)}
                          className="h-10 w-10"
                        >
                          {isCurrentPlaying ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
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
