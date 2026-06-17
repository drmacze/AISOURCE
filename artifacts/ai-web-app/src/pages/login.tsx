import { motion } from "framer-motion";
import { LogIn, Zap, Shield, Bot, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/");
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Card */}
        <div className="bg-card/80 backdrop-blur-xl border border-border/60 rounded-2xl p-8 shadow-2xl">
          {/* Logo */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Bot className="w-8 h-8 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary animate-pulse" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Syne, sans-serif" }}>
                DLavie OS
              </h1>
              <p className="text-muted-foreground text-sm mt-1">AI Command Center</p>
            </div>
          </div>

          {/* Features */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { icon: Bot,    label: "22 AI Agents" },
              { icon: Zap,    label: "Local LLM" },
              { icon: Shield, label: "OAuth Auth" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-muted/30 border border-border/30">
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
              </div>
            ))}
          </div>

          {/* Login button */}
          <Button
            className="w-full h-12 text-base font-semibold gap-2"
            onClick={() => { window.location.href = "/api/login"; }}
          >
            <LogIn className="w-4 h-4" />
            Sign in with Replit
            <ArrowRight className="w-4 h-4 ml-auto" />
          </Button>

          <p className="text-center text-xs text-muted-foreground/60 mt-4">
            Sign in with your Replit account — supports Google, GitHub, and email.
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground/40 mt-4">
          DLavie OS — Fully local, open-source AI workspace
        </p>
      </motion.div>
    </div>
  );
}
