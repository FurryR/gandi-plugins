import { variableChangeEventBus } from "./dev-tools-observer";

export interface VariableChangeEventDetail {
  propertyName: string;
  value: VM.Variable;
}

const onChange = (eventName: string, propertyName: string, value: VM.Variable | string) => {
  variableChangeEventBus.emit(eventName, {
    propertyName,
    value,
  });
};

function proxyVariableList(value: Array<string | boolean | number>, eventName: string) {
  return new Proxy(value, {
    set(list, idx, val) {
      list[idx] = val;
      if (idx !== "length") {
        onChange(eventName, "value", [...list] as any);
      }
      return true;
    },
  });
}

export function addProxy(variable: VM.Variable) {
  const eventName = `${variable.targetId}${variable.id}`;
  const type = variable.type;
  let value =
    type === "list" ? proxyVariableList(variable.value as (string | number | boolean)[], eventName) : variable.value;
  let name = variable.name;
  Object.defineProperties(variable, {
    value: {
      get() {
        return value;
      },
      set: function (newValue) {
        const oldValue = value;
        if (type === "list") {
          newValue = proxyVariableList(newValue, eventName);
        }
        value = newValue;
        if (oldValue !== newValue) {
          onChange(eventName, "value", newValue);
        }
      },
    },
    name: {
      get() {
        return name;
      },
      set(newName: string) {
        const oldName = name;
        name = newName;
        if (oldName !== newName) {
          onChange(eventName, "name", name);
        }
      },
    },
  });
}

export function removeProxy(variable: VM.Variable, target: VM.RenderedTarget) {
  const { id, name, type, value, isCloud, targetId } = variable;
  const Variable = variable.constructor as any;
  target.variables[id] = new Variable(id, name, type, isCloud, targetId);
  target.variables[id].value = type === "list" ? [...value] : value;
}
