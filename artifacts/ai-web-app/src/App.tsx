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
import NotFound from "@/pages/not-found";

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
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/models" component={ModelsPage} />
        <Route path="/generate" component={Generate} />
        <Route path="/api-keys" component={ApiKeys} />
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
