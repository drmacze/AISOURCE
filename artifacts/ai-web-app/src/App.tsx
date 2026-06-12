import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
import { useTrainingNotifications } from "@/hooks/useTrainingNotifications";

import Dashboard from "@/pages/dashboard";
import Chat from "@/pages/chat";
import Rag from "@/pages/rag";
import Training from "@/pages/training";
import ApiDocs from "@/pages/api-docs";
import ModelsPage from "@/pages/models";
import Generate from "@/pages/generate";
import ApiKeys from "@/pages/api-keys";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";
import AIToolsPage from "@/pages/ai-tools";
import PromptsPage from "@/pages/prompts";
import AnalyticsPage from "@/pages/analytics";
import NotebookPage from "@/pages/notebook";
import WebSearchPage from "@/pages/websearch";
import AgentPage from "@/pages/agent";
import PlaygroundPage from "@/pages/playground";
import TrainingLabPage from "@/pages/training-lab";
import StoragePage from "@/pages/storage";
import WhatsAppPage from "@/pages/whatsapp";
import WaBotPage from "@/pages/wa-bot";
import BotsPage from "@/pages/bots";
import BrandKitPage from "@/pages/brand-kit";
import OpenClawPage from "@/pages/openclaw";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/">
          <Redirect to="/dashboard" />
        </Route>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/chat" component={Chat} />
        <Route path="/chat/:id" component={Chat} />
        <Route path="/rag" component={Rag} />
        <Route path="/training" component={Training} />
        <Route path="/models" component={ModelsPage} />
        <Route path="/generate" component={Generate} />
        <Route path="/ai-tools" component={AIToolsPage} />
        <Route path="/prompts" component={PromptsPage} />
        <Route path="/analytics" component={AnalyticsPage} />
        <Route path="/api-keys" component={ApiKeys} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/notebook" component={NotebookPage} />
        <Route path="/web-search" component={WebSearchPage} />
        <Route path="/agent" component={AgentPage} />
        <Route path="/storage" component={StoragePage} />
        <Route path="/playground" component={PlaygroundPage} />
        <Route path="/training-lab" component={TrainingLabPage} />
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/bots" component={BotsPage} />
        <Route path="/brand-kit" component={BrandKitPage} />
        <Route path="/whatsapp" component={WhatsAppPage} />
        <Route path="/wa-bot" component={WaBotPage} />
        <Route path="/openclaw" component={OpenClawPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function AppInner() {
  useTrainingNotifications();
  return (
    <>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
      <Toaster />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppInner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
