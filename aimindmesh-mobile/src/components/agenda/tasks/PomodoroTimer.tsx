/**
 * Pomodoro Timer Component
 * Timer widget for focused work sessions on tasks
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CalendarTask } from '../../../types/calendar';
import * as TaskDB from '../../../services/calendar/taskDatabase';
import { logger } from '../../../services/logger';

interface PomodoroTimerProps {
    task: CalendarTask;
    onComplete?: () => void;
    onClose?: () => void;
}

const POMODORO_DURATION = 25 * 60; // 25 minutes in seconds
const BREAK_DURATION = 5 * 60; // 5 minutes in seconds

const PomodoroTimer: React.FC<PomodoroTimerProps> = ({ task, onComplete, onClose }) => {
    const [timeLeft, setTimeLeft] = useState(POMODORO_DURATION);
    const [isRunning, setIsRunning] = useState(false);
    const [isBreak, setIsBreak] = useState(false);
    const [currentPomodoroCount, setCurrentPomodoroCount] = useState(task.pomodoroCount);

    const handleTimerComplete = useCallback(async () => {
        if (!isBreak) {
            // Work session complete - increment pomodoro count
            const newCount = currentPomodoroCount + 1;
            setCurrentPomodoroCount(newCount);

            try {
                await TaskDB.updateTask(task.id, {
                    pomodoroCount: newCount
                });
                logger.log('info', `[Pomodoro] Completed session ${newCount} for task ${task.id}`);
            } catch (error) {
                logger.log('error', '[Pomodoro] Failed to update pomodoro count', error);
            }

            onComplete?.();
        }

        // Toggle between work and break
        setIsBreak(!isBreak);
        setTimeLeft(isBreak ? POMODORO_DURATION : BREAK_DURATION);
        setIsRunning(false);
    }, [isBreak, currentPomodoroCount, task.id, onComplete]);

    useEffect(() => {
        if (!isRunning) return;

        const interval = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    handleTimerComplete();
                    return isBreak ? POMODORO_DURATION : BREAK_DURATION;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isRunning, isBreak, handleTimerComplete]);

    const toggleTimer = () => {
        setIsRunning(!isRunning);
    };

    const resetTimer = () => {
        setIsRunning(false);
        setTimeLeft(isBreak ? BREAK_DURATION : POMODORO_DURATION);
    };

    const skipToBreak = () => {
        setIsBreak(true);
        setTimeLeft(BREAK_DURATION);
        setIsRunning(false);
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const progress = isBreak
        ? ((BREAK_DURATION - timeLeft) / BREAK_DURATION) * 100
        : ((POMODORO_DURATION - timeLeft) / POMODORO_DURATION) * 100;

    const circumference = 2 * Math.PI * 88;
    const strokeDashoffset = circumference * (1 - progress / 100);

    return (
        <div className="bg-surface rounded-xl shadow-xl p-6 max-w-sm mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">
                    {isBreak ? '☕ Pausa' : '🍅 Focus'}
                </h3>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/10 rounded-full transition"
                    >
                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Task Title */}
            <p className="text-sm text-gray-400 mb-4 line-clamp-2">
                {task.title}
            </p>

            {/* Circular Progress */}
            <div className="relative w-48 h-48 mx-auto mb-4">
                <svg className="transform -rotate-90 w-48 h-48">
                    {/* Background circle */}
                    <circle
                        cx="96"
                        cy="96"
                        r="88"
                        stroke="rgba(255,255,255,0.1)"
                        strokeWidth="8"
                        fill="none"
                    />
                    {/* Progress circle */}
                    <circle
                        cx="96"
                        cy="96"
                        r="88"
                        stroke={isBreak ? '#10b981' : '#ef4444'}
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        className="transition-all duration-1000"
                    />
                </svg>

                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-4xl font-bold text-white">
                        {formatTime(timeLeft)}
                    </span>
                </div>
            </div>

            {/* Controls */}
            <div className="flex justify-center gap-3 mb-4">
                <button
                    onClick={toggleTimer}
                    className={`p-3 rounded-full transition ${isRunning
                            ? 'bg-orange-900/50 text-orange-400 hover:bg-orange-900/70'
                            : 'bg-green-900/50 text-green-400 hover:bg-green-900/70'
                        }`}
                >
                    {isRunning ? (
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    ) : (
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    )}
                </button>

                <button
                    onClick={resetTimer}
                    className="p-3 rounded-full bg-white/10 text-gray-400 hover:bg-white/20 transition"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>

                {!isBreak && (
                    <button
                        onClick={skipToBreak}
                        className="p-3 rounded-full bg-white/10 text-gray-400 hover:bg-white/20 transition"
                        title="Salta alla pausa"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Pomodoro Progress */}
            {task.pomodoroTarget && task.pomodoroTarget > 0 && (
                <div className="pt-4 border-t border-white/10">
                    <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-gray-400">Progresso giornaliero</span>
                        <span className="font-semibold text-white">
                            {currentPomodoroCount} / {task.pomodoroTarget} 🍅
                        </span>
                    </div>
                    <div className="bg-gray-700 rounded-full h-2">
                        <div
                            className="bg-red-500 h-2 rounded-full transition-all"
                            style={{
                                width: `${Math.min((currentPomodoroCount / task.pomodoroTarget) * 100, 100)}%`
                            }}
                        />
                    </div>

                    {currentPomodoroCount >= task.pomodoroTarget && (
                        <p className="text-center text-green-400 text-sm mt-2">
                            🎉 Obiettivo raggiunto!
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default PomodoroTimer;
