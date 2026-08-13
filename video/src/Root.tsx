import { Composition } from "remotion";
import { HerdrAutomationsFeatureVideo } from "./Video";

export const Root = () => {
  return (
    <Composition
      id="HerdrAutomationsFeature"
      component={HerdrAutomationsFeatureVideo}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
