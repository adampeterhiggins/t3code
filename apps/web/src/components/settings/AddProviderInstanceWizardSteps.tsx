import { WizardSteps } from "../ui/wizard";
import {
  ADD_PROVIDER_WIZARD_STEPS,
  resolveWizardNavigation,
  type WizardNavigation,
} from "./AddProviderInstanceDialog.logic";

interface AddProviderInstanceWizardStepsProps {
  readonly currentStep: number;
  readonly summaries: readonly (string | null)[];
  readonly instanceIdError: string | null;
  /** Forward bound: how many steps navigation may reach (caps the sign-in step until the instance exists). */
  readonly navigableStepCount: number;
  /** Backward bound: lowest reachable step (locks the wizard on sign-in once the instance exists). */
  readonly minStep: number;
  readonly onNavigation: (navigation: WizardNavigation) => void;
}

export function AddProviderInstanceWizardSteps({
  currentStep,
  summaries,
  instanceIdError,
  navigableStepCount,
  minStep,
  onNavigation,
}: AddProviderInstanceWizardStepsProps) {
  return (
    <WizardSteps
      steps={ADD_PROVIDER_WIZARD_STEPS}
      currentStep={currentStep}
      summaries={summaries}
      onStepChange={(requestedStep) =>
        onNavigation(
          resolveWizardNavigation(
            currentStep,
            requestedStep,
            navigableStepCount,
            {
              instanceIdError,
            },
            minStep,
          ),
        )
      }
    />
  );
}
