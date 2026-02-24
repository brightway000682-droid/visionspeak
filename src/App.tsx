/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, 
  Upload, 
  Search, 
  Volume2, 
  Play, 
  Pause, 
  ChevronRight, 
  History, 
  BookOpen, 
  Settings,
  Languages,
  Image as ImageIcon,
  Loader2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactPlayer from 'react-player';
import { 
  analyzeImageContext, 
  generateSpeech, 
  generateVisualAnchor, 
  processVideoUrl, 
  analyzeWordInContext,
  WordAnalysis 
} from './services/geminiService';

interface WordRecord extends WordAnalysis {
  id?: number;
  image_url?: string;
  created_at?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'scan' | 'video' | 'dictionary' | 'review'>('scan');
  const [videoUrl, setVideoUrl] = useState('');
  const [isVideoProcessing, setIsVideoProcessing] = useState(false);
  const [videoSubtitles, setVideoSubtitles] = useState<{time: string, text: string, translation: string}[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState<WordRecord[]>([]);
  const [selectedWord, setSelectedWord] = useState<WordRecord | null>(null);
  const [accent, setAccent] = useState<'US' | 'UK'>('US');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [history, setHistory] = useState<WordRecord[]>([]);
  
  const [currentSubIndex, setCurrentSubIndex] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isAnalyzingWord, setIsAnalyzingWord] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const Player = ReactPlayer as any;

  useEffect(() => {
    if (activeTab === 'video' && !isPaused) {
      const timer = setTimeout(() => setShowControls(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [activeTab, isPaused, currentSubIndex]);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/words');
      const data = await res.json();
      setHistory(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setIsScanning(true);
      try {
        const analysis = await analyzeImageContext(base64);
        // For each word, generate a visual anchor
        const enrichedResults = await Promise.all(analysis.map(async (item) => {
          const imageUrl = await generateVisualAnchor(item.image_prompt);
          return { ...item, image_url: imageUrl };
        }));
        setResults(enrichedResults);
      } catch (err) {
        console.error(err);
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const playAudio = async (text: string, loop: boolean = false) => {
    if (isPlaying && !loop) return;
    setIsPlaying(true);
    try {
      const base64Audio = await generateSpeech(text, accent);
      if (base64Audio) {
        // Add WAV header to raw PCM data (24kHz, 16-bit, mono)
        const pcmData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
        const sampleRate = 24000;
        const numChannels = 1;
        const bitsPerSample = 16;
        
        const header = new ArrayBuffer(44);
        const view = new DataView(header);
        
        const writeString = (offset: number, string: string) => {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + pcmData.length, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
        view.setUint16(32, numChannels * bitsPerSample / 8, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, pcmData.length, true);
        
        const blob = new Blob([header, pcmData], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        const audio = new Audio(url);
        audio.playbackRate = playbackSpeed;
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (isLooping) {
            playAudio(text, true);
          } else {
            setIsPlaying(false);
          }
        };
        audio.play().catch(err => {
          console.error("Audio play failed:", err);
          setIsPlaying(false);
        });
      }
    } catch (e) {
      console.error(e);
      setIsPlaying(false);
    }
  };

  const timeToSeconds = (timeStr: string) => {
    const [m, s] = timeStr.split(':').map(Number);
    return m * 60 + s;
  };

  const handleProgress = (state: { playedSeconds: number }) => {
    if (videoSubtitles.length === 0) return;
    
    // Find the current subtitle segment based on video time
    const currentTime = state.playedSeconds;
    let bestIndex = 0;
    for (let i = 0; i < videoSubtitles.length; i++) {
      if (timeToSeconds(videoSubtitles[i].time) <= currentTime) {
        bestIndex = i;
      } else {
        break;
      }
    }
    if (bestIndex !== currentSubIndex) {
      setCurrentSubIndex(bestIndex);
    }
  };

  const handleVideoProcess = async () => {
    if (!videoUrl) return;
    setIsVideoProcessing(true);
    setVideoSubtitles([]);
    try {
      const subs = await processVideoUrl(videoUrl);
      setVideoSubtitles(subs);
      setCurrentSubIndex(0);
    } catch (err) {
      console.error(err);
      // Fallback to mock if API fails
      setVideoSubtitles([
        { time: "00:05", text: "Welcome to this English lesson.", translation: "欢迎来到这堂英语课。" },
        { time: "00:12", text: "Today we are going to talk about idioms.", translation: "今天我们要讨论一些习语。" },
        { time: "00:20", text: "It's a piece of cake, really.", translation: "这真的很简单，小菜一碟。" }
      ]);
    } finally {
      setIsVideoProcessing(false);
    }
  };

  const saveWord = async (word: WordRecord) => {
    try {
      await fetch('/api/words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: word.word,
          context_sentence: word.context_explanation,
          meaning: word.meaning,
          phonetic_us: word.phonetic_us,
          phonetic_uk: word.phonetic_uk,
          image_url: word.image_url
        })
      });
      fetchHistory();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto bg-[#F8F7F4] shadow-xl overflow-hidden relative">
      {/* Header */}
      <header className="p-6 flex justify-between items-center bg-white border-b border-black/5">
        <div>
          <h1 className="text-2xl font-serif font-bold tracking-tight text-emerald-600">VisionSpeak</h1>
          <p className="text-[10px] uppercase tracking-widest font-semibold opacity-40">Contextual Learning</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setAccent(accent === 'US' ? 'UK' : 'US')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-100 transition-all hover:bg-emerald-100"
          >
            <Languages size={14} />
            {accent}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 pb-24">
        <AnimatePresence mode="wait">
          {activeTab === 'scan' && (
            <motion.div 
              key="scan"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Upload Section */}
              {!results.length && !isScanning && (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-video rounded-3xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-50 transition-colors group"
                >
                  <div className="w-16 h-16 rounded-full bg-white shadow-soft flex items-center justify-center text-emerald-600 mb-4 group-hover:scale-110 transition-transform">
                    <Camera size={32} />
                  </div>
                  <p className="font-medium text-emerald-900">Upload Screenshot</p>
                  <p className="text-xs text-emerald-600/60 mt-1">Extract context from your video frames</p>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*" 
                    onChange={handleFileUpload}
                  />
                </div>
              )}

              {isScanning && (
                <div className="aspect-video rounded-3xl bg-white shadow-soft flex flex-col items-center justify-center p-8 text-center">
                  <Loader2 className="animate-spin text-emerald-600 mb-4" size={40} />
                  <h3 className="font-serif text-xl font-bold">Analyzing Context...</h3>
                  <p className="text-sm text-gray-500 mt-2">Gemini is identifying words and generating visual anchors.</p>
                </div>
              )}

              {results.length > 0 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h2 className="font-serif text-xl font-bold">Identified Words</h2>
                    <button onClick={() => setResults([])} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
                  </div>
                  {results.map((item, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      onClick={() => {
                        setSelectedWord(item);
                        saveWord(item);
                      }}
                      className="p-4 rounded-2xl bg-white shadow-soft border border-black/5 flex items-center gap-4 cursor-pointer hover:border-emerald-200 transition-all"
                    >
                      <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.word} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <ImageIcon size={24} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-lg">{item.word}</h3>
                        <p className="text-xs text-gray-500 line-clamp-1 italic">{item.meaning}</p>
                      </div>
                      <ChevronRight size={20} className="text-gray-300" />
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'video' && (
            <motion.div 
              key="video"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {videoSubtitles.length === 0 ? (
                <div className="p-6 rounded-3xl bg-white shadow-soft border border-black/5 space-y-4">
                  <div className="flex items-center gap-3 text-emerald-600 mb-2">
                    <Play size={24} fill="currentColor" />
                    <h2 className="font-serif text-xl font-bold text-gray-900">Video Analysis</h2>
                  </div>
                  <p className="text-sm text-gray-500">Paste a YouTube link or video URL to generate bilingual subtitles and extract vocabulary.</p>
                  
                  <div className="space-y-3">
                    <input 
                      type="text" 
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..." 
                      className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-sm"
                    />
                    <button 
                      onClick={handleVideoProcess}
                      disabled={isVideoProcessing || !videoUrl}
                      className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-100 disabled:opacity-50"
                    >
                      {isVideoProcessing ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
                      {isVideoProcessing ? 'Processing Video...' : 'Analyze Video'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex justify-between items-center px-2">
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setVideoSubtitles([])}
                        className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                      >
                        <X size={16} />
                      </button>
                      <h3 className="font-serif text-lg font-bold">Interactive Player</h3>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      <span>CN Top</span>
                      <div className="w-4 h-px bg-gray-300"></div>
                      <span>EN Bottom</span>
                    </div>
                  </div>

                  {/* Immersive Subtitle View */}
                  <div className="relative aspect-video rounded-[2.5rem] bg-black overflow-hidden shadow-2xl border border-white/10 group/player">
                    {/* Real Video Player */}
                    <div className="absolute inset-0">
                      <Player
                        url={videoUrl}
                        width="100%"
                        height="100%"
                        playing={!isPaused}
                        muted={false}
                        controls={true}
                        onProgress={handleProgress}
                        onPause={() => setIsPaused(true)}
                        onPlay={() => setIsPaused(false)}
                        playbackRate={playbackSpeed}
                        loop={isLooping}
                        config={{
                          youtube: {
                            disablekb: 1,
                            rel: 0,
                            cc_load_policy: 0,
                            iv_load_policy: 3
                          }
                        }}
                        fallback={
                          <img 
                            src={`https://picsum.photos/seed/${videoUrl.length}/800/450?grayscale`} 
                            className="w-full h-full object-cover opacity-50" 
                            alt="Video background"
                            referrerPolicy="no-referrer"
                          />
                        }
                      />
                    </div>
                    
                    {/* Subtitle Overlays (Pointer events none so they don't block player controls) */}
                    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between py-12 px-6">
                      {/* Top: Chinese Translation */}
                      <div className="flex justify-center">
                        <motion.div 
                          key={`cn-${currentSubIndex}`}
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="max-w-[90%]"
                        >
                          <span className="text-emerald-400 font-medium text-base text-center block leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                            {videoSubtitles[currentSubIndex]?.translation}
                          </span>
                        </motion.div>
                      </div>

                      {/* Bottom: English Original (Interactive) - Moved higher to avoid blocking controls */}
                      <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 pointer-events-auto max-w-[95%] mx-auto mb-12">
                        {videoSubtitles[currentSubIndex]?.text.split(' ').map((word, wIdx) => (
                          <motion.span 
                            key={`${currentSubIndex}-${wIdx}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            whileHover={{ scale: 1.1, color: '#10b981' }}
                            onClick={async (e) => {
                              e.stopPropagation();
                              setIsPaused(true);
                              setIsAnalyzingWord(true);
                              const cleanWord = word.replace(/[.,!?]/g, '');
                              try {
                                const analysis = await analyzeWordInContext(cleanWord, videoSubtitles[currentSubIndex].text);
                                const imageUrl = await generateVisualAnchor(analysis.image_prompt);
                                const wordData = { ...analysis, image_url: imageUrl };
                                setSelectedWord(wordData);
                                saveWord(wordData);
                              } catch (err) {
                                console.error(err);
                              } finally {
                                setIsAnalyzingWord(false);
                              }
                            }}
                            className="text-white font-bold text-xl cursor-pointer hover:text-emerald-400 transition-colors drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                          >
                            {word}
                          </motion.span>
                        ))}
                      </div>
                    </div>

                    {/* Navigation Overlays */}
                    <AnimatePresence>
                      {showControls && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 pointer-events-none"
                        >
                          {/* Central Play/Pause Toggle Area */}
                          <div 
                            className="absolute inset-0 flex items-center justify-center pointer-events-auto cursor-pointer"
                            onClick={() => setIsPaused(!isPaused)}
                          >
                            {isPaused && (
                              <motion.div 
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white"
                              >
                                <Play size={40} fill="currentColor" />
                              </motion.div>
                            )}
                          </div>

                          <div className="absolute inset-y-0 left-0 w-12 flex items-center justify-center pointer-events-auto">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentSubIndex((currentSubIndex - 1 + videoSubtitles.length) % videoSubtitles.length);
                              }}
                              className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-all"
                            >
                              <ChevronRight size={20} className="rotate-180" />
                            </button>
                          </div>
                          
                          <div className="absolute inset-y-0 right-0 w-12 flex items-center justify-center pointer-events-auto">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentSubIndex((currentSubIndex + 1) % videoSubtitles.length);
                              }}
                              className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-all"
                            >
                              <ChevronRight size={20} />
                            </button>
                          </div>

                          {/* Speed & Loop Controls - Moved higher */}
                          <div className="absolute bottom-24 left-0 right-0 flex justify-center gap-4 pointer-events-auto">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setPlaybackSpeed(prev => prev === 1 ? 0.75 : prev === 0.75 ? 0.5 : 1);
                              }}
                              className="px-4 py-1.5 rounded-full bg-black/60 text-white text-[10px] font-bold border border-white/10 backdrop-blur-sm"
                            >
                              {playbackSpeed}x
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsLooping(!isLooping);
                              }}
                              className={`px-4 py-1.5 rounded-full text-[10px] font-bold border backdrop-blur-sm transition-all ${isLooping ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-black/60 text-white border-white/10'}`}
                            >
                              LOOP
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Structured Transcript List */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Interactive Transcript</p>
                      <span className="text-[10px] text-emerald-600 font-bold">{videoSubtitles.length} Segments</span>
                    </div>
                    
                    <div className="space-y-3">
                      {videoSubtitles.map((sub, idx) => (
                        <div 
                          key={idx} 
                          onClick={() => setCurrentSubIndex(idx)}
                          className={`p-5 rounded-3xl border transition-all cursor-pointer group ${idx === currentSubIndex ? 'bg-white border-emerald-500 shadow-lg shadow-emerald-500/5' : 'bg-white border-black/5 hover:border-emerald-200'}`}
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <span className="font-mono text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-1 rounded-lg">
                              {sub.time}
                            </span>
                            <div className="h-px flex-1 bg-gray-100"></div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                playAudio(sub.text);
                              }}
                              className="p-2 rounded-full bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                            >
                              <Volume2 size={16} />
                            </button>
                          </div>
                          
                          <div className="space-y-2">
                            <p className="text-emerald-700 font-bold text-sm leading-relaxed">
                              {sub.translation}
                            </p>
                            <p className="text-gray-500 text-xs font-medium leading-relaxed">
                              {sub.text}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
          {activeTab === 'dictionary' && (
            <motion.div 
              key="dictionary"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input 
                  type="text" 
                  placeholder="Search vocabulary..." 
                  className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white shadow-soft border-none focus:ring-2 focus:ring-emerald-500 transition-all"
                />
              </div>
              
              <div className="space-y-4">
                <h2 className="font-serif text-xl font-bold">Recent History</h2>
                {history.map((item, idx) => (
                  <div 
                    key={idx}
                    onClick={() => setSelectedWord(item)}
                    className="p-4 rounded-2xl bg-white shadow-soft border border-black/5 flex items-center gap-4 cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold">
                      {item.word[0].toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold">{item.word}</h3>
                      <p className="text-xs text-gray-400">{new Date(item.created_at || '').toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
          {activeTab === 'review' && (
            <motion.div 
              key="review"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="bg-emerald-600 rounded-[2rem] p-8 text-white relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-emerald-200 text-xs font-bold uppercase tracking-widest mb-2">Daily Challenge</p>
                  <h2 className="text-3xl font-serif font-bold mb-4">Master 5 New Words</h2>
                  <p className="text-emerald-100 text-sm mb-6 opacity-80">You've saved {history.length} words this week. Ready to review?</p>
                  <button className="bg-white text-emerald-600 px-6 py-3 rounded-2xl font-bold shadow-xl shadow-emerald-900/20 active:scale-95 transition-all">
                    Start Session
                  </button>
                </div>
                <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-white/10 rounded-full blur-3xl"></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-6 rounded-3xl border border-black/5 shadow-soft">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center mb-4">
                    <History size={20} />
                  </div>
                  <p className="text-2xl font-bold">12</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Day Streak</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-black/5 shadow-soft">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center mb-4">
                    <BookOpen size={20} />
                  </div>
                  <p className="text-2xl font-bold">{history.length}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Total Words</p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-serif text-xl font-bold">Recommended for Review</h3>
                <div className="space-y-3">
                  {history.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="p-4 rounded-2xl bg-white border border-black/5 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-bold text-gray-400">
                          {item.word[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold">{item.word}</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Last seen 2 days ago</p>
                        </div>
                      </div>
                      <button className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors">
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Word Detail Modal */}
      <AnimatePresence>
        {(selectedWord || isAnalyzingWord) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setSelectedWord(null)}
          >
            {isAnalyzingWord ? (
              <div className="w-full max-w-md bg-white rounded-[40px] p-12 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="animate-spin text-emerald-600" size={48} />
                <p className="font-serif text-xl font-bold">Analyzing Context...</p>
                <p className="text-sm text-gray-500">Gemini is locking in the precise meaning.</p>
              </div>
            ) : selectedWord && (
              <motion.div 
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="w-full max-w-md bg-white rounded-t-[40px] p-8 space-y-6"
                onClick={e => e.stopPropagation()}
              >
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-4xl font-serif font-bold">{selectedWord.word}</h2>
                  <div className="flex gap-4 mt-2">
                    <div className="flex items-center gap-1 text-emerald-600 font-mono text-sm">
                      <span className="opacity-40">US</span> {selectedWord.phonetic_us}
                    </div>
                    <div className="flex items-center gap-1 text-blue-600 font-mono text-sm">
                      <span className="opacity-40">UK</span> {selectedWord.phonetic_uk}
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedWord(null)}
                  className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="aspect-video rounded-3xl bg-gray-100 overflow-hidden shadow-inner">
                {selectedWord.image_url ? (
                  <img src={selectedWord.image_url} alt={selectedWord.word} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <ImageIcon size={48} />
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                  <p className="text-xs font-bold text-emerald-700 uppercase tracking-widest mb-1">Contextual Meaning</p>
                  <p className="text-emerald-900 font-medium">{selectedWord.meaning}</p>
                </div>
                
                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Context Explanation</p>
                  <p className="text-gray-700 text-sm italic">"{selectedWord.context_explanation}"</p>
                </div>
              </div>

              <div className="flex gap-4 items-center pt-4">
                <button 
                  onClick={() => playAudio(selectedWord.word)}
                  disabled={isPlaying}
                  className="flex-1 h-16 rounded-2xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 active:scale-95 transition-all disabled:opacity-50"
                >
                  {isPlaying ? <Loader2 className="animate-spin" size={24} /> : <Volume2 size={24} />}
                  Listen {accent}
                </button>
                <div className="flex flex-col gap-1">
                  <button 
                    onClick={() => setPlaybackSpeed(playbackSpeed === 1 ? 0.75 : playbackSpeed === 0.75 ? 0.5 : 1)}
                    className="w-16 h-16 rounded-2xl bg-gray-100 text-gray-600 font-bold flex items-center justify-center text-xs"
                  >
                    {playbackSpeed}x
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto h-20 bg-white/80 backdrop-blur-xl border-t border-black/5 flex items-center justify-around px-6 z-40">
        <NavButton 
          active={activeTab === 'scan'} 
          onClick={() => setActiveTab('scan')} 
          icon={<Camera size={24} />} 
          label="Scan" 
        />
        <NavButton 
          active={activeTab === 'video'} 
          onClick={() => setActiveTab('video')} 
          icon={<Play size={24} />} 
          label="Video" 
        />
        <NavButton 
          active={activeTab === 'dictionary'} 
          onClick={() => setActiveTab('dictionary')} 
          icon={<BookOpen size={24} />} 
          label="Library" 
        />
        <NavButton 
          active={activeTab === 'review'} 
          onClick={() => setActiveTab('review')} 
          icon={<History size={24} />} 
          label="Review" 
        />
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all ${active ? 'text-emerald-600' : 'text-gray-400'}`}
    >
      <div className={`p-2 rounded-xl transition-all ${active ? 'bg-emerald-50' : ''}`}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </button>
  );
}
