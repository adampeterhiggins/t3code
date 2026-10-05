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
  readonly steps?: readonly string[];
  readonly identityStep?: number;
  readonly prerequisite?: {
    readonly step: number;
    readonly error: string | null;
  };
  /** Forward bound: how many steps navigation may reach (caps the sign-in step until the instance exists). Defaults to every step. */
  readonly navigableStepCount?: number | undefined;
  /** Backward bound: lowest reachable step (locks the wizard on sign-in once the instance exists). */
  readonly minStep?: number;
  readonly onNavigation: (navigation: WizardNavigation) => void;
  readonly disabled?: boolean;
}

export function AddProviderInstanceWizardSteps({
  currentStep,
  summaries,
  instanceIdError,
  steps = ADD_PROVIDER_WIZARD_STEPS,
  identityStep,
  prerequisite,
  navigableStepCount,
  minStep = 0,
  onNavigation,
  disabled = false,
}: AddProviderInstanceWizardStepsProps) {
  return (
    <WizardSteps
      steps={steps}
      currentStep={currentStep}
      summaries={summaries}
      isStepDisabled={() => disabled}
      onStepChange={(requestedStep) =>
        onNavigation(
          resolveWizardNavigation(
            currentStep,
            requestedStep,
            navigableStepCount ?? steps.length,
            {
              instanceIdError,
              ...(identityStep === undefined ? {} : { identityStep }),
              ...(prerequisite === undefined ? {} : { prerequisite }),
            },
            minStep,
          ),
        )
      }
    />
  );
}
