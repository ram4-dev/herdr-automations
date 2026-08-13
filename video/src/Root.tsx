import { Composition } from "remotion";
import { AutomationPermissionsVideo } from "./Video";

export const Root = () => {
  return (
    <Composition
      id="HerdrAutomationPermissions"
      component={AutomationPermissionsVideo}
      durationInFrames={1050}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
