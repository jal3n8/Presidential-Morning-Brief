import { About } from "./components/About";
import { FanGlobePreview } from "./components/FanGlobePreview";
import { FinalSignup } from "./components/FinalSignup";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Reasons } from "./components/Reasons";
import { SampleEdition } from "./components/SampleEdition";
import { SocialProof } from "./components/SocialProof";

export default function App() {
  return (
    <>
      <a href="#signup" className="sr-only z-50 rounded-lg bg-gold px-4 py-3 font-semibold text-space focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to the signup form
      </a>
      <Header />
      <main>
        <Hero />
        <Reasons />
        <SampleEdition />
        <FanGlobePreview />
        <SocialProof />
        <About />
        <FinalSignup />
      </main>
      <Footer />
    </>
  );
}
