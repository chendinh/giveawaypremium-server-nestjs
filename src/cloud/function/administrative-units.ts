import * as administativeUnits from '../../constants/units.json'; 

export const getAdministativeUnits = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any> => {
  return administativeUnits;
};
